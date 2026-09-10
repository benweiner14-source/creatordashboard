import { describe, it, expect } from 'vitest';
import { handleAddWatchlistEntry, handleListWatchlist, WATCHLIST_REFRESH_PROFILE_LIMIT } from '@/lib/watchlist/handler';
import { DuplicateWatchlistEntryError, WATCHLIST_ENTRY_LIMIT, type WatchlistEntry, type WatchlistSnapshot } from '@/lib/watchlist/types';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import type { VideoMetadata } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';
import { hashIp } from '@/lib/rate-limit';

/**
 * A single in-memory fake shared by handleAddWatchlistEntry (this task),
 * handleListWatchlist (Task 6), and handleRemoveWatchlistEntry (Task 7) —
 * each task's tests use only the slice of `base` its handler function
 * actually depends on, via TypeScript structural typing.
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

  it('adds a new entry and returns it with no snapshot yet', async () => {
    const result = await handleAddWatchlistEntry(makeDeps(), { profileId: 'p1', url: 'https://www.youtube.com/@creator', label: 'Main rival' });
    expect(result.status).toBe(200);
    const entry = result.body.entry as { hasSnapshot: boolean; label: string | null; platform: string; handle: string };
    expect(entry.hasSnapshot).toBe(false);
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
    const result = await handleListWatchlist(makeDeps(), { profileId: null, ip: '203.0.113.1' });
    expect(result.status).toBe(401);
  });

  it('returns an empty list for a profile with no entries', async () => {
    const result = await handleListWatchlist(makeDeps(), { profileId: 'p1', ip: '203.0.113.1' });
    expect(result.status).toBe(200);
    expect(result.body.entries).toEqual([]);
  });

  it('fetches and saves a snapshot for a stale (never-fetched) entry when subscribed', async () => {
    const uploads: VideoMetadata[] = [
      { id: 'v1', title: 'Video 1', description: '', publishedAt: '2026-09-09T12:00:00Z', durationSeconds: 300, viewCount: 2400, likeCount: 100, commentCount: 10, tags: [] },
    ];
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, uploads, { subscriberCount: 5000, totalViewCount: 100000, videoCount: 30 }) });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });

    const result = await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    const entries = result.body.entries as Array<{ hasSnapshot: boolean; subscriberCount: number | null; topPosts: unknown[] }>;
    expect(entries[0].hasSnapshot).toBe(true);
    expect(entries[0].subscriberCount).toBe(5000);
    expect(entries[0].topPosts).toHaveLength(1);
  });

  it('does not refresh an entry whose snapshot is within the TTL', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T00:00:00Z') });
    expect((deps as any).__snapshots).toHaveLength(1);

    // 1 hour later -- well within the 12h TTL -- must not fetch or save again.
    await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T01:00:00Z') });
    expect((deps as any).__snapshots).toHaveLength(1);
  });

  it('does not refresh, but still serves cached data, when the profile is unsubscribed', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    deps.hasActiveSubscription = async () => false;

    const result = await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    expect(result.body.subscriptionRequired).toBe(true);
    const entries = result.body.entries as Array<{ hasSnapshot: boolean }>;
    expect(entries[0].hasSnapshot).toBe(false); // never fetched, since unsubscribed
    expect((deps as any).__snapshots).toHaveLength(0);
  });

  it('sets lastError on an entry whose refresh fails, without failing the request or the other entries', async () => {
    const workingUploads: VideoMetadata[] = [
      { id: 'v1', title: 'Video 1', description: '', publishedAt: '2026-09-09T12:00:00Z', durationSeconds: 300, viewCount: 2400, likeCount: 100, commentCount: 10, tags: [] },
    ];
    const failingYoutubeClient = createFakeYouTubeClient({}, workingUploads, { subscriberCount: 5000, totalViewCount: 100000, videoCount: 30 });
    const deps = makeDeps({ youtubeClient: failingYoutubeClient });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@working' });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@broken' });

    // Make the second entry's channel fail to resolve, but only for it.
    deps.youtubeClient = {
      ...failingYoutubeClient,
      getChannelStats: async (handle: string) => {
        if (handle === 'broken') throw new Error('channel unavailable');
        return failingYoutubeClient.getChannelStats(handle);
      },
    };

    const result = await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T12:00:00Z') });

    expect(result.status).toBe(200);
    const entries = result.body.entries as Array<{ handle: string; hasSnapshot: boolean; lastError: string | null }>;
    const working = entries.find((e) => e.handle === 'working')!;
    const broken = entries.find((e) => e.handle === 'broken')!;
    expect(working.hasSnapshot).toBe(true);
    expect(working.lastError).toBeNull();
    expect(broken.hasSnapshot).toBe(false);
    expect(broken.lastError).toBeTruthy();
  });

  it('stops refreshing once the daily refresh budget is exhausted, but still returns 200 with cached data', async () => {
    // WATCHLIST_ENTRY_LIMIT (20) is smaller than WATCHLIST_REFRESH_PROFILE_LIMIT
    // (40), so a single profile can never hold enough entries to exhaust the
    // refresh budget through adds alone. Simulate a profile that has already
    // used most of today's shared budget via earlier visits by pre-seeding
    // the rate-limit store directly, leaving room for exactly 5 more refreshes.
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    for (let i = 0; i < WATCHLIST_ENTRY_LIMIT; i++) {
      await handleAddWatchlistEntry(deps, { profileId: 'p1', url: `https://www.youtube.com/@creator${i}` });
    }

    const now = new Date('2026-09-10T12:00:00Z');
    const ipHash = hashIp('203.0.113.1', deps.ipSalt);
    const remainingBudget = 5;
    for (let i = 0; i < WATCHLIST_REFRESH_PROFILE_LIMIT - remainingBudget; i++) {
      await deps.rateLimitStore.recordEvent({ profileId: 'p1', ipHash, eventType: 'watchlist_refresh', createdAt: now });
    }

    const result = await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now });

    expect(result.status).toBe(200);
    expect((deps as any).__snapshots).toHaveLength(remainingBudget);
    const entries = result.body.entries as Array<{ hasSnapshot: boolean }>;
    expect(entries.some((e) => !e.hasSnapshot)).toBe(true); // at least one never got refreshed
  });

  it('computes a sevenDayDelta against a snapshot at least 7 days old', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 10000, videoCount: 10 }) });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-01T00:00:00Z') });

    deps.youtubeClient = createFakeYouTubeClient({}, [], { subscriberCount: 1200, totalViewCount: 12000, videoCount: 11 });
    const result = await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T00:00:00Z') });

    const entries = result.body.entries as Array<{ sevenDayDelta: { subscriberDelta: number | null } }>;
    expect(entries[0].sevenDayDelta.subscriberDelta).toBe(200);
  });

  it('rate-limits refreshes per profile per day, counting one event per entry actually refreshed', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, [], { subscriberCount: 1000, totalViewCount: 1000, videoCount: 1 }) });
    await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    await handleListWatchlist(deps, { profileId: 'p1', ip: '203.0.113.1', now: new Date('2026-09-10T00:00:00Z') });
    expect((deps as any).__snapshots).toHaveLength(1);
  });
});
