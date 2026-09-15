import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import { ChannelNotFoundError, type YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import { detectHandlePlatform, normalizeHandle } from '@/lib/recap/handles';
import { buildSnapshotSummary, computeDeltas } from './aggregate';
import {
  DuplicateWatchlistEntryError,
  WATCHLIST_ENTRY_LIMIT,
  type ChannelSnapshotInputPost,
  type SnapshotDeltas,
  type WatchlistEntry,
  type WatchlistEntryView,
  type WatchlistSnapshot,
} from './types';

export interface WatchlistHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export const WATCHLIST_SNAPSHOT_TTL_HOURS = 12;
export const WATCHLIST_REFRESH_PROFILE_LIMIT = 40;
export const WATCHLIST_REFRESH_IP_LIMIT = 80;
const MS_PER_HOUR = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * MS_PER_HOUR;
const THIRTY_DAYS_MS = 30 * 24 * MS_PER_HOUR;

export function isSnapshotStale(snapshot: WatchlistSnapshot | null, now: Date): boolean {
  if (!snapshot) return true;
  return now.getTime() - new Date(snapshot.capturedAt).getTime() > WATCHLIST_SNAPSHOT_TTL_HOURS * MS_PER_HOUR;
}

function toEntryView(
  entry: WatchlistEntry,
  snapshot: WatchlistSnapshot | null,
  isStale: boolean,
  sevenDayDelta: SnapshotDeltas | null = null,
  thirtyDayDelta: SnapshotDeltas | null = null
): WatchlistEntryView {
  return {
    id: entry.id,
    platform: entry.platform,
    handle: entry.handle,
    url: entry.url,
    label: entry.label,
    lastError: entry.lastError,
    hasSnapshot: snapshot !== null,
    isStale,
    subscriberCount: snapshot?.subscriberCount ?? null,
    totalViewCount: snapshot?.totalViewCount ?? null,
    videoCount: snapshot?.videoCount ?? null,
    topPosts: snapshot?.topPosts ?? [],
    sevenDayDelta,
    thirtyDayDelta,
  };
}

/** Read-side deps shared by the list and refresh entry points. */
interface DeltaLookupDeps {
  getSnapshotAtOrBefore: (entryId: string, cutoff: Date) => Promise<WatchlistSnapshot | null>;
}

async function computeEntryDeltas(
  deps: DeltaLookupDeps,
  entryId: string,
  snapshot: WatchlistSnapshot | null,
  now: Date
): Promise<{ sevenDayDelta: SnapshotDeltas | null; thirtyDayDelta: SnapshotDeltas | null }> {
  if (!snapshot) {
    return { sevenDayDelta: null, thirtyDayDelta: null };
  }
  const [sevenDayBaseline, thirtyDayBaseline] = await Promise.all([
    deps.getSnapshotAtOrBefore(entryId, new Date(now.getTime() - SEVEN_DAYS_MS)),
    deps.getSnapshotAtOrBefore(entryId, new Date(now.getTime() - THIRTY_DAYS_MS)),
  ]);
  return {
    sevenDayDelta: computeDeltas(snapshot, sevenDayBaseline),
    thirtyDayDelta: computeDeltas(snapshot, thirtyDayBaseline),
  };
}

// ---- Add ----

export interface AddWatchlistEntryDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  countEntries: (profileId: string) => Promise<number>;
  insertEntry: (params: {
    profileId: string;
    platform: WatchlistEntry['platform'];
    handle: string;
    url: string;
    label: string | null;
  }) => Promise<WatchlistEntry>;
}

export interface AddWatchlistEntryContext {
  profileId: string | null;
  url: string;
  label?: string;
}

export async function handleAddWatchlistEntry(
  deps: AddWatchlistEntryDeps,
  context: AddWatchlistEntryContext
): Promise<WatchlistHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to add a competitor.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'Adding a competitor requires an active subscription.', upgradeUrl: '/billing' } };
  }

  const platform = detectHandlePlatform(context.url);
  const handle = platform ? normalizeHandle(platform, context.url) : null;
  if (!platform || !handle) {
    return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram channel URL.' } };
  }

  const existingCount = await deps.countEntries(context.profileId);
  if (existingCount >= WATCHLIST_ENTRY_LIMIT) {
    return { status: 400, body: { error: `You've reached the ${WATCHLIST_ENTRY_LIMIT}-competitor limit.` } };
  }

  try {
    const entry = await deps.insertEntry({
      profileId: context.profileId,
      platform,
      handle,
      url: context.url,
      label: context.label?.trim() || null,
    });
    // A brand-new entry has no snapshot yet, so it is stale by definition —
    // the client refreshes it in the background right after adding.
    return { status: 200, body: { entry: toEntryView(entry, null, true) } };
  } catch (err) {
    if (err instanceof DuplicateWatchlistEntryError) {
      return { status: 409, body: { error: "You're already tracking this channel." } };
    }
    throw err;
  }
}

// ---- List (read-only) ----

/**
 * Deliberately read-only: no fetch clients, no rate-limit store, no writes.
 * Refreshing a stale entry costs an external API call and a rate-limit slot,
 * so it lives behind POST /api/watchlist/refresh (see
 * handleRefreshWatchlistEntry) rather than riding along on a GET — matching
 * the same reasoning documented on `app/api/linkedin/ideas/route.ts`'s GET,
 * and giving this handler a bounded, predictable per-request cost.
 */
export interface ListWatchlistDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  listEntries: (profileId: string) => Promise<WatchlistEntry[]>;
  getLatestSnapshot: (entryId: string) => Promise<WatchlistSnapshot | null>;
  getSnapshotAtOrBefore: (entryId: string, cutoff: Date) => Promise<WatchlistSnapshot | null>;
}

export interface ListWatchlistContext {
  profileId: string | null;
  now?: Date;
}

export async function handleListWatchlist(deps: ListWatchlistDeps, context: ListWatchlistContext): Promise<WatchlistHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to view your watchlist.' } };
  }

  const now = context.now ?? new Date();
  const [entries, subscribed] = await Promise.all([
    deps.listEntries(context.profileId),
    deps.hasActiveSubscription(context.profileId),
  ]);

  const views: WatchlistEntryView[] = [];
  for (const entry of entries) {
    const snapshot = await deps.getLatestSnapshot(entry.id);
    const { sevenDayDelta, thirtyDayDelta } = await computeEntryDeltas(deps, entry.id, snapshot, now);
    views.push(toEntryView(entry, snapshot, isSnapshotStale(snapshot, now), sevenDayDelta, thirtyDayDelta));
  }

  return { status: 200, body: { entries: views, subscriptionRequired: !subscribed } };
}

// ---- Refresh a single entry ----

export interface RefreshWatchlistEntryDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getEntry: (profileId: string, entryId: string) => Promise<WatchlistEntry | null>;
  getLatestSnapshot: (entryId: string) => Promise<WatchlistSnapshot | null>;
  getSnapshotAtOrBefore: (entryId: string, cutoff: Date) => Promise<WatchlistSnapshot | null>;
  insertSnapshot: (snapshot: WatchlistSnapshot) => Promise<void>;
  clearEntryError: (entryId: string) => Promise<void>;
  setEntryError: (entryId: string, message: string) => Promise<void>;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  rateLimitStore: RateLimitStore;
  ipSalt: string;
}

export interface RefreshWatchlistEntryContext {
  profileId: string | null;
  ip: string;
  entryId: string;
  now?: Date;
}

async function fetchChannelSnapshotInput(
  deps: Pick<RefreshWatchlistEntryDeps, 'youtubeClient' | 'scraperClient'>,
  entry: WatchlistEntry
): Promise<{ subscriberCount: number | null; totalViewCount: number; videoCount: number; posts: ChannelSnapshotInputPost[] }> {
  if (entry.platform === 'youtube') {
    const [stats, uploads] = await Promise.all([
      deps.youtubeClient.getChannelStats(entry.handle),
      deps.youtubeClient.getChannelUploads(entry.handle),
    ]);
    return {
      subscriberCount: stats.subscriberCount,
      totalViewCount: stats.totalViewCount,
      videoCount: stats.videoCount,
      posts: uploads.map((v) => ({
        captionOrTitle: v.title,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        viewCount: v.viewCount,
        publishedAt: v.publishedAt,
      })),
    };
  }

  const scraped = await deps.scraperClient.fetchProfilePosts(entry.platform, entry.handle);
  // Apify doesn't reliably expose a channel-level lifetime view total for
  // TikTok/Instagram the way YouTube's channels.list statistics does, so
  // totalViewCount/videoCount here are a sum over the fetched pool (up to 50
  // most recent posts) -- an honest proxy, not a true lifetime total. The UI
  // suppresses the "since <date>" delta badge on these two figures for
  // non-YouTube entries, since a rolling window's delta isn't growth.
  return {
    subscriberCount: scraped[0]?.followerCount ?? null,
    totalViewCount: scraped.reduce((sum, post) => sum + post.viewCount, 0),
    videoCount: scraped.length,
    posts: scraped.map((post) => ({
      captionOrTitle: post.caption,
      url: post.permalink,
      viewCount: post.viewCount,
      publishedAt: post.publishedAt,
    })),
  };
}

/**
 * Refreshes exactly one entry. The paid, rate-limited, externally-fetching
 * half of the watchlist — everything GET used to do inline, scoped to a single
 * entry so each request has a bounded cost.
 *
 * A refresh that is skipped (still fresh, or out of daily budget) or that
 * fails to fetch is never a request-level failure: the caller gets 200 with
 * the entry's current cached view and `refreshed: false`.
 */
export async function handleRefreshWatchlistEntry(
  deps: RefreshWatchlistEntryDeps,
  context: RefreshWatchlistEntryContext
): Promise<WatchlistHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to refresh a competitor.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'Refreshing a competitor requires an active subscription.', upgradeUrl: '/billing' } };
  }

  // Ownership is checked explicitly in the lookup, not left to RLS — the same
  // convention DELETE /api/watchlist/[id] follows. Without it, any signed-in
  // profile could burn another profile's refresh budget and API quota.
  const entry = await deps.getEntry(context.profileId, context.entryId);
  if (!entry) {
    return { status: 404, body: { error: 'Watchlist entry not found.' } };
  }

  const now = context.now ?? new Date();
  let currentSnapshot = await deps.getLatestSnapshot(entry.id);
  let lastError = entry.lastError;
  let refreshed = false;

  const respond = async () => {
    const { sevenDayDelta, thirtyDayDelta } = await computeEntryDeltas(deps, entry.id, currentSnapshot, now);
    return {
      status: 200,
      body: {
        entry: toEntryView(
          { ...entry, lastError },
          currentSnapshot,
          isSnapshotStale(currentSnapshot, now),
          sevenDayDelta,
          thirtyDayDelta
        ),
        refreshed,
      },
    };
  };

  // Idempotent no-op when the cached snapshot is still fresh: a client that's
  // slightly out of sync about staleness shouldn't spend budget or quota.
  if (!isSnapshotStale(currentSnapshot, now)) {
    return respond();
  }

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash: hashIp(context.ip, deps.ipSalt),
    eventType: 'watchlist_refresh',
    profileLimit: WATCHLIST_REFRESH_PROFILE_LIMIT,
    ipLimit: WATCHLIST_REFRESH_IP_LIMIT,
    windowDays: 1,
    now,
  });

  // Out of daily budget: serve what we have. Per the spec this is an expected
  // state, not an error the client has to handle.
  if (!rateLimitResult.allowed) {
    return respond();
  }

  try {
    const fetched = await fetchChannelSnapshotInput(deps, entry);
    const summary = buildSnapshotSummary(fetched, now);
    const snapshot: WatchlistSnapshot = { entryId: entry.id, capturedAt: now.toISOString(), ...summary };
    await deps.insertSnapshot(snapshot);

    // The snapshot is durably saved, so this refresh succeeded — reflect that
    // in the response before touching last_error. A failure to clear the error
    // column is a bookkeeping problem, not a reason to keep showing a stale
    // error message (and its blanked-out row) for the rest of the TTL window.
    currentSnapshot = snapshot;
    lastError = null;
    refreshed = true;
    try {
      await deps.clearEntryError(entry.id);
    } catch {
      // Intentionally swallowed: the next successful refresh will clear it.
    }
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    const message =
      err instanceof ChannelNotFoundError
        ? "We couldn't find this channel anymore — it may have been renamed or removed."
        : "Couldn't refresh this competitor's stats. Will retry next visit.";
    lastError = message;
    try {
      await deps.setEntryError(entry.id, message);
    } catch {
      // Same reasoning as clearEntryError above: the response still reports the
      // failure accurately even if the column write didn't land.
    }
  }

  return respond();
}

// ---- Remove ----

export interface RemoveWatchlistEntryDeps {
  deleteEntry: (profileId: string, entryId: string) => Promise<boolean>;
}

export interface RemoveWatchlistEntryContext {
  profileId: string | null;
  entryId: string;
}

export async function handleRemoveWatchlistEntry(
  deps: RemoveWatchlistEntryDeps,
  context: RemoveWatchlistEntryContext
): Promise<WatchlistHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to remove a competitor.' } };
  }

  const deleted = await deps.deleteEntry(context.profileId, context.entryId);
  if (!deleted) {
    return { status: 404, body: { error: 'Watchlist entry not found.' } };
  }
  return { status: 204, body: {} };
}
