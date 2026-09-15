export const WATCHLIST_ENTRY_LIMIT = 20;

export interface RankedPost {
  captionOrTitle: string;
  url: string;
  viewCount: number;
  publishedAt: string;
  viewsPerHour: number;
}

export interface ChannelSnapshotInputPost {
  captionOrTitle: string;
  url: string;
  viewCount: number;
  publishedAt: string;
}

export interface ChannelSnapshotInput {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
  posts: ChannelSnapshotInputPost[];
}

export interface SnapshotSummary {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
  topPosts: RankedPost[];
}

export interface SnapshotDeltaInput {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
}

export interface SnapshotDeltas {
  subscriberDelta: number | null;
  totalViewDelta: number | null;
  videoDelta: number | null;
  comparedAgainstCapturedAt: string | null;
}

export interface WatchlistEntry {
  id: string;
  profileId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  handle: string;
  url: string;
  label: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface WatchlistSnapshot {
  entryId: string;
  capturedAt: string;
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
  topPosts: RankedPost[];
}

export interface WatchlistEntryView {
  id: string;
  platform: WatchlistEntry['platform'];
  handle: string;
  url: string;
  label: string | null;
  lastError: string | null;
  hasSnapshot: boolean;
  /**
   * True when this entry has no snapshot at all, or its latest one is older
   * than WATCHLIST_SNAPSHOT_TTL_HOURS. GET /api/watchlist is read-only, so the
   * client uses this to decide which entries to refresh in the background via
   * POST /api/watchlist/refresh.
   */
  isStale: boolean;
  subscriberCount: number | null;
  totalViewCount: number | null;
  videoCount: number | null;
  topPosts: RankedPost[];
  sevenDayDelta: SnapshotDeltas | null;
  thirtyDayDelta: SnapshotDeltas | null;
}

/**
 * Thrown by an `insertEntry` implementation when the
 * (profile_id, platform, handle) uniqueness constraint is violated — lets
 * handleAddWatchlistEntry distinguish "already tracking this channel" (409)
 * from a genuine infrastructure failure (500).
 */
export class DuplicateWatchlistEntryError extends Error {
  constructor() {
    super('This channel is already on your watchlist.');
    this.name = 'DuplicateWatchlistEntryError';
  }
}
