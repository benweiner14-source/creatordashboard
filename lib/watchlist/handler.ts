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
