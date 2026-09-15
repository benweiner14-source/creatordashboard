import { describe, it, expect } from 'vitest';
import {
  handleAddWatchlistEntry,
  handleListWatchlist,
  handleRefreshWatchlistEntry,
  handleRemoveWatchlistEntry,
  WATCHLIST_REFRESH_PROFILE_LIMIT,
} from '@/lib/watchlist/handler';
import { DuplicateWatchlistEntryError, WATCHLIST_ENTRY_LIMIT, type WatchlistEntry, type WatchlistSnapshot } from '@/lib/watchlist/types';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import type { VideoMetadata } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';
import { hashIp } from '@/lib/rate-limit';

/**
 * A single in-memory fake shared by handleAddWatchlistEntry,
 * handleListWatchlist, handleRefreshWatchlistEntry and
 * handleRemoveWatchlistEntry — each handler's tests use only the slice of
 * `base` its function actually depends on, via TypeScript structural typing.
 */
function makeDeps(overrides: Record<string, unknown> = {}) {
  const entries: WatchlistEntry[] = [];
  const snapshots: WatchlistSnapshot[] = [];
  let nextId = 1;

  const base = {
    hasActiveSubscription: async () => true,
    countEntries: async (profileId: string) => entries.filter((e) => e.profileId === profileId).length,
    insertEntry: async (params: { profileId: string; platform: WatchlistEntry['platform']; handle: string; url: string; label: string | null }) => {
      const duplicate = entries.find(
        (e) => e.profileId === params.profileId && e.platform === params.platform && e.handle === params.handle
      );
      if (duplicate) throw new DuplicateWatchlistEntryError();
      const entry: WatchlistEntry = {
        id: `entry-${nextId++}`,
        profileId: params.profileId,
        platform: params.platform,
        handle: params.handle,
        url: params.url,
        label: params.label,
        lastError: null,
        createdAt: new Date().toISOString(),
      };
      entries.push(entry);
      return entry;
    },
    listEntries: async (profileId: string) => entries.filter((e) => e.profileId === profileId),
    getEntry: async (profileId: string, entryId: string) =>
      entries.find((e) => e.id === entryId && e.profileId === profileId) ?? null,
    deleteEntry: async (profileId: string, entryId: string) => {
      const index = entries.findIndex((e) => e.id === entryId && e.profileId === profileId);
      if (index === -1) return false;
      entries.splice(index, 1);
      return true;
    },
    getLatestSnapshot: async (entryId: string) => {
      const matches = snapshots.filter((s) => s.entryId === entryId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      return matches[0] ?? null;
    },
    getSnapshotAtOrBefore: async (entryId: string, cutoff: Date) => {
      const matches = snapshots
        .filter((s) => s.entryId === entryId && new Date(s.capturedAt).getTime() <= cutoff.getTime())
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      return matches[0] ?? null;
    },
    insertSnapshot: async (snapshot: WatchlistSnapshot) => {
      snapshots.push(snapshot);
    },
    clearEntryError: async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      if (entry) entry.lastError = null;
    },
    setEntryError: async (entryId: string, message: string) => {
      const entry = entries.find((e) => e.id === entryId);
      if (entry) entry.lastError = message;
    },
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    rateLimitStore: createInMemoryRateLimitStore(),
    ipSalt: 'test-salt',
  };

  return { ...base, ...overrides, __entries: entries, __snapshots: snapshots };
}

type ListedEntry = {
  id: string;
  handle: string;
  hasSnapshot: boolean;
  isStale: boolean;
  lastError: string | null;
  subscriberCount: number | null;
  totalViewCount: number | null;
  videoCount: number | null;
  topPosts: Array<{ viewsPerHour: number }>;
  sevenDayDelta: { subscriberDelta: number | null; comparedAgainstCapturedAt: string | null } | null;
  thirtyDayDelta: { subscriberDelta: number | null } | null;
};

async function addEntry(deps: ReturnType<typeof makeDeps>, url: string, profileId = 'p1') {
  const added = await handleAddWatchlistEntry(deps, { profileId, url });
  return (added.body.entry as { id: string }).id;
}

describe('handleAddWatchlistEntry', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleAddWatchlistEntry(makeDeps(), { profileId: null, url: 'https://www.youtube.com/@creator' });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('rejects an unsupported URL', async () => {
    const result = await handleAddWatchlistEntry(makeDeps(), { profileId: 'p1', url: 'https://example.com/creator' });
    expect(result.status).toBe(400);
  });

  it('adds a new entry and returns it with no snapshot yet, flagged stale so the client fetches one', async () => {
    const result = await handleAddWatchlistEntry(makeDeps(), { profileId: 'p1', url: 'https://www.youtube.com/@creator', label: 'Main rival' });
    expect(result.status).toBe(200);
    const entry = result.body.entry as { hasSnapshot: boolean; isStale: boolean; label: string | null; platform: string; handle: string };
    expect(entry.hasSnapshot).toBe(false);
    expect(entry.isStale).toBe(true);
    expect(entry.label).toBe('Main rival');
    expect(entry.platform).toBe('youtube');
    expect(entry.handle).toBe('creator');
  });

  it('rejects adding the same channel twice', async () => {
    const deps = makeDeps();
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    const result = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    expect(result.status).toBe(409);
  });

  it('rejects adding a 21st competitor', async () => {
    const deps = makeDeps();
    for (let i = 0; i < WATCHLIST_ENTRY_LIMIT; i++) {
      const result = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: `https://www.youtube.com/@creator${i}` });
      expect(result.status).toBe(200);
    }
    const result = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@onemore' });
    expect(result.status).toBe(400);
  });
});

describe('handleListWatchlist', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleListWatchlist(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('returns an empty list for a profile with no entries', async () => {
    const result = await handleListWatchlist(makeDeps(), { profileId: 'p1' });
    expect(result.status).toBe(200);
    expect(result.body.entries).toEqual([]);
  });

  it('is read-only: a never-fetched entry comes back stale, with no snapshot written and no external call made', async () => {
    // The fetch clients here throw on any use. handleListWatchlist doesn't even
    // declare them as deps, so this is belt-and-braces against a regression
    // that re-introduces refresh-on-GET.
    const exploding = {
      getChannelStats: async () => {
        throw new Error('handleListWatchlist must not fetch');
      },
      getChannelUploads: async () => {
        throw new Error('handleListWatchlist must not fetch');
      },
    };
    const deps = makeDeps({ youtubeClient: { ...createFakeYouTubeClient(), ...exploding } });
    await addEntry(deps, 'https://www.youtube.com/@creator');

    const result = await handleListWatchlist(deps, { profileId: 'p1', now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    const entries = result.body.entries as ListedEntry[];
    expect(entries[0].hasSnapshot).toBe(false);
    expect(entries[0].isStale).toBe(true);
    expect(deps.__snapshots).toHaveLength(0);
  });

  it('serves a cached snapshot and marks it fresh while it is within the TTL', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 4000, videoCount: 3 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T00:00:00Z') });

    const result = await handleListWatchlist(deps, { profileId: 'p1', now: new Date('2026-09-10T01:00:00Z') });

    const entries = result.body.entries as ListedEntry[];
    expect(entries[0].hasSnapshot).toBe(true);
    expect(entries[0].isStale).toBe(false);
    expect(entries[0].subscriberCount).toBe(1000);
  });

  it('marks a snapshot older than the TTL as stale', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 4000, videoCount: 3 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T00:00:00Z') });

    // 13 hours later -- past the 12h TTL.
    const result = await handleListWatchlist(deps, { profileId: 'p1', now: new Date('2026-09-10T13:00:00Z') });

    const entries = result.body.entries as ListedEntry[];
    expect(entries[0].hasSnapshot).toBe(true);
    expect(entries[0].isStale).toBe(true);
  });

  it('serves cached data with subscriptionRequired for an unsubscribed profile', async () => {
    const deps = makeDeps();
    await addEntry(deps, 'https://www.youtube.com/@creator');
    deps.hasActiveSubscription = async () => false;

    const result = await handleListWatchlist(deps, { profileId: 'p1', now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.subscriptionRequired).toBe(true);
    expect(deps.__snapshots).toHaveLength(0);
  });

  it('computes a sevenDayDelta against a snapshot at least 7 days old', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 10000, videoCount: 10 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-01T00:00:00Z') });

    deps.youtubeClient = createFakeYouTubeClient({}, [], { subscriberCount: 1200, totalViewCount: 12000, videoCount: 11 });
    await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T00:00:00Z') });

    const result = await handleListWatchlist(deps, { profileId: 'p1', now: new Date('2026-09-10T00:00:00Z') });
    const entries = result.body.entries as ListedEntry[];
    expect(entries[0].sevenDayDelta!.subscriberDelta).toBe(200);
    expect(entries[0].sevenDayDelta!.comparedAgainstCapturedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('handleRefreshWatchlistEntry', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleRefreshWatchlistEntry(makeDeps(), { profileId: null, ip: '203.0.113.1', entryId: 'entry-1' });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription — refreshing is the paid action', async () => {
    const deps = makeDeps();
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    deps.hasActiveSubscription = async () => false;

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId });

    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
    expect(deps.__snapshots).toHaveLength(0);
  });

  it('returns 404 without spending budget when the entry belongs to another profile', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1, totalViewCount: 1, videoCount: 1 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator', 'p1');

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p2', ip: '203.0.113.1', entryId });

    expect(result.status).toBe(404);
    expect(deps.__snapshots).toHaveLength(0);
    const ipHash = hashIp('203.0.113.1', deps.ipSalt);
    expect(
      await deps.rateLimitStore.countEventsSince({ ipHash, eventType: 'watchlist_refresh', since: new Date(0) })
    ).toBe(0);
  });

  it('returns 404 for an entry that does not exist', async () => {
    const result = await handleRefreshWatchlistEntry(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', entryId: 'nope' });
    expect(result.status).toBe(404);
  });

  it('fetches and saves a snapshot for a never-fetched entry', async () => {
    const uploads: VideoMetadata[] = [
      { id: 'v1', title: 'Video 1', description: '', publishedAt: '2026-09-09T12:00:00Z', durationSeconds: 300, viewCount: 2400, likeCount: 100, commentCount: 10, tags: [] },
    ];
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, uploads, { subscriberCount: 5000, totalViewCount: 100000, videoCount: 30 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(true);
    const entry = result.body.entry as ListedEntry;
    expect(entry.hasSnapshot).toBe(true);
    expect(entry.isStale).toBe(false);
    expect(entry.subscriberCount).toBe(5000);
    expect(entry.topPosts).toHaveLength(1);
    expect(deps.__snapshots).toHaveLength(1);
  });

  it('summarises a TikTok/Instagram profile from the scraped post pool', async () => {
    const profilePosts: ProfilePost[] = [
      {
        platform: 'tiktok',
        id: 'p1',
        caption: 'Wait for it',
        permalink: 'https://www.tiktok.com/@creator/video/1',
        publishedAt: '2026-09-09T12:00:00Z',
        viewCount: 24000,
        likeCount: 900,
        commentCount: 60,
        followerCount: 42000,
      },
      {
        platform: 'tiktok',
        id: 'p2',
        caption: 'Second post',
        permalink: 'https://www.tiktok.com/@creator/video/2',
        publishedAt: '2026-09-08T12:00:00Z',
        viewCount: 6000,
        likeCount: 100,
        commentCount: 5,
        followerCount: 42000,
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, profilePosts) });
    const entryId = await addEntry(deps, 'https://www.tiktok.com/@creator');

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(true);
    const entry = result.body.entry as ListedEntry;
    // Follower count comes off the first post; totals are a sum over the pool.
    expect(entry.subscriberCount).toBe(42000);
    expect(entry.totalViewCount).toBe(30000);
    expect(entry.videoCount).toBe(2);
    // 24000 views over 24h ranks above 6000 over 48h.
    expect(entry.topPosts.map((p) => Math.round(p.viewsPerHour))).toEqual([1000, 125]);
  });

  it('falls back to a null subscriber count when the scraper returns no follower count', async () => {
    const profilePosts: ProfilePost[] = [
      {
        platform: 'instagram',
        id: 'p1',
        caption: 'A reel',
        permalink: 'https://www.instagram.com/p/1/',
        publishedAt: '2026-09-09T12:00:00Z',
        viewCount: 1200,
        likeCount: 10,
        commentCount: 1,
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, profilePosts) });
    const entryId = await addEntry(deps, 'https://www.instagram.com/creator/');

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T12:00:00Z') });

    expect((result.body.entry as ListedEntry).subscriberCount).toBeNull();
  });

  it('is a no-op when the cached snapshot is still fresh — no external call, no budget spent', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T00:00:00Z') });
    expect(deps.__snapshots).toHaveLength(1);

    deps.youtubeClient = {
      ...deps.youtubeClient,
      getChannelStats: async () => {
        throw new Error('a fresh entry must not be re-fetched');
      },
    };

    // 1 hour later -- well within the 12h TTL.
    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T01:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(false);
    expect((result.body.entry as ListedEntry).hasSnapshot).toBe(true);
    expect(deps.__snapshots).toHaveLength(1);
    const ipHash = hashIp('203.0.113.1', deps.ipSalt);
    expect(await deps.rateLimitStore.countEventsSince({ ipHash, eventType: 'watchlist_refresh', since: new Date(0) })).toBe(1);
  });

  it('serves the cached view with refreshed:false — not an error — when the daily budget is exhausted', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');

    const now = new Date('2026-09-10T12:00:00Z');
    const ipHash = hashIp('203.0.113.1', deps.ipSalt);
    for (let i = 0; i < WATCHLIST_REFRESH_PROFILE_LIMIT; i++) {
      await deps.rateLimitStore.recordEvent({ profileId: 'p1', ipHash, eventType: 'watchlist_refresh', createdAt: now });
    }

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(false);
    expect((result.body.entry as ListedEntry).hasSnapshot).toBe(false);
    expect(deps.__snapshots).toHaveLength(0);
  });

  it('records lastError and releases the rate-limit event when the fetch fails, still returning 200', async () => {
    const deps = makeDeps({
      youtubeClient: {
        ...createFakeYouTubeClient(),
        getChannelStats: async () => {
          throw new Error('channel unavailable');
        },
      },
    });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@broken');

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(false);
    const entry = result.body.entry as ListedEntry;
    expect(entry.hasSnapshot).toBe(false);
    expect(entry.lastError).toBeTruthy();
    expect(deps.__entries[0].lastError).toBeTruthy();
    // A refresh that failed on infrastructure must not burn part of the budget.
    const ipHash = hashIp('203.0.113.1', deps.ipSalt);
    expect(await deps.rateLimitStore.countEventsSince({ ipHash, eventType: 'watchlist_refresh', since: new Date(0) })).toBe(0);
  });

  it('reports a successful refresh even when clearing the stored error afterwards fails', async () => {
    const deps = makeDeps({
      youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 7777, totalViewCount: 1000, videoCount: 1 }),
      clearEntryError: async () => {
        throw new Error('database unavailable');
      },
    });
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');
    deps.__entries[0].lastError = 'Some earlier failure.';

    const result = await handleRefreshWatchlistEntry(deps, { profileId: 'p1', ip: '203.0.113.1', entryId, now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.refreshed).toBe(true);
    const entry = result.body.entry as ListedEntry;
    // The snapshot landed, so the response must reflect the fresh data and drop
    // the stale error rather than showing a blanked/errored row for a full TTL.
    expect(entry.lastError).toBeNull();
    expect(entry.hasSnapshot).toBe(true);
    expect(entry.subscriberCount).toBe(7777);
    expect(deps.__snapshots).toHaveLength(1);
  });
});

describe('handleRemoveWatchlistEntry', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleRemoveWatchlistEntry(makeDeps(), { profileId: null, entryId: 'entry-1' });
    expect(result.status).toBe(401);
  });

  it('removes an entry the profile owns', async () => {
    const deps = makeDeps();
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');

    const result = await handleRemoveWatchlistEntry(deps, { profileId: 'p1', entryId });
    expect(result.status).toBe(204);
    expect(await deps.listEntries('p1')).toEqual([]);
  });

  it('returns 404 for an entry that does not exist or belongs to someone else', async () => {
    const deps = makeDeps();
    const entryId = await addEntry(deps, 'https://www.youtube.com/@creator');

    const result = await handleRemoveWatchlistEntry(deps, { profileId: 'someone-else', entryId });
    expect(result.status).toBe(404);
    expect(await deps.listEntries('p1')).toHaveLength(1); // untouched
  });
});
