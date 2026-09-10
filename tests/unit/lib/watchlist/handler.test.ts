import { describe, it, expect } from 'vitest';
import { handleAddWatchlistEntry } from '@/lib/watchlist/handler';
import { DuplicateWatchlistEntryError, WATCHLIST_ENTRY_LIMIT, type WatchlistEntry, type WatchlistSnapshot } from '@/lib/watchlist/types';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';

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
