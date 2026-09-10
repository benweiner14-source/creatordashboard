import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import { ChannelNotFoundError, type YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import { detectHandlePlatform, normalizeHandle } from '@/lib/recap/handles';
import { buildSnapshotSummary, computeDeltas } from './aggregate';
import {
  DuplicateWatchlistEntryError,
  WATCHLIST_ENTRY_LIMIT,
  type ChannelSnapshotInputPost,
  type RankedPost,
  type SnapshotDeltas,
  type WatchlistEntry,
  type WatchlistEntryView,
  type WatchlistSnapshot,
} from './types';

export interface WatchlistHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function toEntryView(
  entry: WatchlistEntry,
  snapshot: WatchlistSnapshot | null,
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
    subscriberCount: snapshot?.subscriberCount ?? null,
    totalViewCount: snapshot?.totalViewCount ?? null,
    videoCount: snapshot?.videoCount ?? null,
    topPosts: snapshot?.topPosts ?? [],
    sevenDayDelta,
    thirtyDayDelta,
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
    return { status: 200, body: { entry: toEntryView(entry, null) } };
  } catch (err) {
    if (err instanceof DuplicateWatchlistEntryError) {
      return { status: 409, body: { error: "You're already tracking this channel." } };
    }
    throw err;
  }
}

// ---- List (refresh-on-visit) ----

export const WATCHLIST_SNAPSHOT_TTL_HOURS = 12;
export const WATCHLIST_REFRESH_PROFILE_LIMIT = 40;
export const WATCHLIST_REFRESH_IP_LIMIT = 80;
const MS_PER_HOUR_LIST = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * MS_PER_HOUR_LIST;
const THIRTY_DAYS_MS = 30 * 24 * MS_PER_HOUR_LIST;

export interface ListWatchlistDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  listEntries: (profileId: string) => Promise<WatchlistEntry[]>;
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

export interface ListWatchlistContext {
  profileId: string | null;
  ip: string;
  now?: Date;
}

async function fetchChannelSnapshotInput(
  deps: Pick<ListWatchlistDeps, 'youtubeClient' | 'scraperClient'>,
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
  // most recent posts) -- an honest proxy, not a true lifetime total.
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

export async function handleListWatchlist(deps: ListWatchlistDeps, context: ListWatchlistContext): Promise<WatchlistHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to view your watchlist.' } };
  }

  const now = context.now ?? new Date();
  const [entries, subscribed] = await Promise.all([
    deps.listEntries(context.profileId),
    deps.hasActiveSubscription(context.profileId),
  ]);
  const ipHash = hashIp(context.ip, deps.ipSalt);

  let budgetExhausted = false;
  const views: WatchlistEntryView[] = [];

  for (const entry of entries) {
    let currentSnapshot = await deps.getLatestSnapshot(entry.id);
    let lastError = entry.lastError;
    const isStale =
      !currentSnapshot ||
      now.getTime() - new Date(currentSnapshot.capturedAt).getTime() > WATCHLIST_SNAPSHOT_TTL_HOURS * MS_PER_HOUR_LIST;

    if (subscribed && isStale && !budgetExhausted) {
      const rateLimitResult = await checkAndRecordRateLimit({
        store: deps.rateLimitStore,
        profileId: context.profileId,
        ipHash,
        eventType: 'watchlist_refresh',
        profileLimit: WATCHLIST_REFRESH_PROFILE_LIMIT,
        ipLimit: WATCHLIST_REFRESH_IP_LIMIT,
        windowDays: 1,
        now,
      });

      if (!rateLimitResult.allowed) {
        budgetExhausted = true;
      } else {
        try {
          const fetched = await fetchChannelSnapshotInput(deps, entry);
          const summary = buildSnapshotSummary(fetched, now);
          const snapshot: WatchlistSnapshot = { entryId: entry.id, capturedAt: now.toISOString(), ...summary };
          await deps.insertSnapshot(snapshot);
          await deps.clearEntryError(entry.id);
          currentSnapshot = snapshot;
          lastError = null;
        } catch (err) {
          await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
          const message =
            err instanceof ChannelNotFoundError
              ? "We couldn't find this channel anymore — it may have been renamed or removed."
              : "Couldn't refresh this competitor's stats. Will retry next visit.";
          await deps.setEntryError(entry.id, message);
          lastError = message;
        }
      }
    }

    let sevenDayDelta: SnapshotDeltas | null = null;
    let thirtyDayDelta: SnapshotDeltas | null = null;
    if (currentSnapshot) {
      const [sevenDayBaseline, thirtyDayBaseline] = await Promise.all([
        deps.getSnapshotAtOrBefore(entry.id, new Date(now.getTime() - SEVEN_DAYS_MS)),
        deps.getSnapshotAtOrBefore(entry.id, new Date(now.getTime() - THIRTY_DAYS_MS)),
      ]);
      sevenDayDelta = computeDeltas(currentSnapshot, sevenDayBaseline);
      thirtyDayDelta = computeDeltas(currentSnapshot, thirtyDayBaseline);
    }

    views.push(toEntryView({ ...entry, lastError }, currentSnapshot, sevenDayDelta, thirtyDayDelta));
  }

  return { status: 200, body: { entries: views, subscriptionRequired: !subscribed } };
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
