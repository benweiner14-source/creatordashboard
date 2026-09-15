# Competitor Watchlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in, subscribed creator save up to 20 competitor channels/profiles and see their subscriber/view/video counts (with week-over-week and month-over-month deltas) plus each competitor's current top 5 posts by views-per-hour, refreshed on visit.

**Architecture:** Two new tables (`watchlist_entries`, a tracked channel; `watchlist_snapshots`, a time series under it) back a new `lib/watchlist/` module. `youtube.ts` and `scraper.ts` each gain a small, additive capability (channel-level stats; a best-effort follower count) neither currently has. The handler follows Strategy Breakdown's URL-resolution and fetch pattern, but list/refresh is "stale-while-revalidate": visiting the page refreshes any entry past a 12h TTL, bounded by a shared daily rate-limit budget, and always serves whatever data exists even when that budget or the subscription requirement blocks a fresh fetch. No Claude/LLM call is involved — this is stats and deltas, not a narrative.

**Tech Stack:** Next.js (App Router, TypeScript), Supabase (Postgres, Auth), Vitest + Testing Library, Playwright — same stack as the rest of the app, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-competitor-watchlist-design.md`

## Global Constraints

- Up to 20 tracked competitors per profile — enforced in the handler (400), not a DB constraint.
- Any of the three platforms (YouTube, TikTok, Instagram), independent of the creator's own connected platform.
- Refresh-on-visit only — no scheduled/cron refresh. Per-entry TTL is 12 hours.
- Refresh abuse guard: `watchlist_refresh` rate-limit event, 40/day per profile, 80/day per IP, one event per entry actually refreshed (not per page load).
- Viewing the watchlist (already-saved entries and their cached snapshots) is sign-in-gated only. Adding an entry and refreshing an entry's data are paid-gated (`hasActiveSubscription`, 402 if not subscribed). An unsubscribed signed-in user still sees their existing entries and cached data — never locked out of data they already paid to generate.
- A refresh failing for one entry never fails the whole page load — the entry gets `lastError` set and the rest continue normally.
- An exhausted daily refresh budget serves stale data with no error — never fails the page load.
- Follower/subscriber count: `null` and rendered as "—" when unavailable (YouTube's is reliable; TikTok/Instagram's is best-effort).
- No route unit tests — routes stay thin wiring, verified via handler unit tests + Playwright E2E, per this repo's convention.
- No Claude/LLM call anywhere in this feature.

---

## File Structure

```
supabase/migrations/
  20260910000001_create_watchlist_tables.sql   # watchlist_entries + watchlist_snapshots

lib/
  supabase/
    types.ts                       # + watchlist_entries, watchlist_snapshots (modify)
  integrations/
    youtube.ts                     # + ChannelStats, getChannelStats (modify)
    scraper.ts                     # + ProfilePost.followerCount (modify)
  watchlist/
    types.ts                       # shared types + WATCHLIST_ENTRY_LIMIT
    aggregate.ts                   # computeViewsPerHour, buildSnapshotSummary, computeDeltas
    handler.ts                     # handleAddWatchlistEntry, handleListWatchlist, handleRemoveWatchlistEntry
    page-state.ts                  # WatchlistPageState/Event, reducer

app/
  page.tsx                         # + Watchlist link (modify)
  api/
    watchlist/
      route.ts                     # GET list+refresh, POST add
      [id]/route.ts                 # DELETE remove
  watchlist/
    page.tsx                        # management page

components/
  AppNav.tsx                        # + Watchlist nav link (modify)

tests/
  unit/
    supabase/
      migrations.test.ts            # + watchlist cases (modify)
    lib/
      integrations/
        youtube.test.ts             # + getChannelStats cases (modify)
        scraper.test.ts             # + followerCount cases (modify)
      watchlist/
        aggregate.test.ts
        handler.test.ts
        page-state.test.ts
    app/
      page-content.test.tsx         # + Watchlist link case (modify)
      watchlist/
        page.test.tsx
    components/
      AppNav.test.tsx                # + Watchlist link case (modify)
  e2e/
    watchlist-smoke.spec.ts
```

---

### Task 1: `watchlist_entries` + `watchlist_snapshots` migration + Database types

**Files:**
- Create: `supabase/migrations/20260910000001_create_watchlist_tables.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: `public.profiles`, the existing `public.diagnostic_platform` enum
- Produces: `public.watchlist_entries`, `public.watchlist_snapshots` tables; `Database['public']['Tables']['watchlist_entries']`, `Database['public']['Tables']['watchlist_snapshots']` — relied on by Task 8 (route inserts/selects), Task 9 (route delete)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`, inside the existing `describe('supabase migrations', ...)` block:
```ts
  it('includes a watchlist_entries table migration unique per profile/platform/handle', () => {
    const sql = readMigrationContaining('create_watchlist_tables');
    expect(sql).toContain('create table public.watchlist_entries');
    expect(sql).toContain('platform public.diagnostic_platform not null');
    expect(sql).toContain('unique (profile_id, platform, handle)');
    expect(sql).toContain('"Watchlist entries are viewable by owner"');
    expect(sql).toContain('"Watchlist entries are insertable by owner"');
    expect(sql).toContain('"Watchlist entries are deletable by owner"');
  });

  it('includes a watchlist_snapshots table migration owned indirectly through its entry', () => {
    const sql = readMigrationContaining('create_watchlist_tables');
    expect(sql).toContain('create table public.watchlist_snapshots');
    expect(sql).toContain('references public.watchlist_entries(id) on delete cascade');
    expect(sql).toContain('top_posts jsonb not null');
    expect(sql).toContain('"Watchlist snapshots are viewable by owner"');
    expect(sql).toContain('watchlist_snapshots_entry_id_captured_at_idx');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_watchlist_tables\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260910000001_create_watchlist_tables.sql
create table public.watchlist_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  handle text not null,
  url text not null,
  label text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (profile_id, platform, handle)
);

alter table public.watchlist_entries enable row level security;

create policy "Watchlist entries are viewable by owner"
  on public.watchlist_entries for select
  using ((select auth.uid()) = profile_id);

create policy "Watchlist entries are insertable by owner"
  on public.watchlist_entries for insert
  with check ((select auth.uid()) = profile_id);

create policy "Watchlist entries are deletable by owner"
  on public.watchlist_entries for delete
  using ((select auth.uid()) = profile_id);

create table public.watchlist_snapshots (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.watchlist_entries(id) on delete cascade,
  captured_at timestamptz not null default now(),
  subscriber_count integer,
  total_view_count bigint not null,
  video_count integer not null,
  top_posts jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.watchlist_snapshots enable row level security;

create policy "Watchlist snapshots are viewable by owner"
  on public.watchlist_snapshots for select
  using (
    exists (
      select 1 from public.watchlist_entries
      where watchlist_entries.id = watchlist_snapshots.entry_id
        and watchlist_entries.profile_id = (select auth.uid())
    )
  );

create index watchlist_snapshots_entry_id_captured_at_idx
  on public.watchlist_snapshots (entry_id, captured_at desc);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Add the Database types**

In `lib/supabase/types.ts`, add two new entries to `Database['public']['Tables']` (alongside `linkedin_profile_audits`, before the closing `};` of `Tables`):
```ts
      watchlist_entries: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          handle: string;
          url: string;
          label: string | null;
          last_error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          handle: string;
          url: string;
          label?: string | null;
          last_error?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['watchlist_entries']['Insert']>;
        Relationships: [];
      };
      watchlist_snapshots: {
        Row: {
          id: string;
          entry_id: string;
          captured_at: string;
          subscriber_count: number | null;
          total_view_count: number;
          video_count: number;
          top_posts: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          entry_id: string;
          captured_at?: string;
          subscriber_count?: number | null;
          total_view_count: number;
          video_count: number;
          top_posts: unknown;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['watchlist_snapshots']['Insert']>;
        Relationships: [];
      };
```
This isn't independently tested here — it's exercised by Task 8's route (`tsc --noEmit` in that task's verification is where a mistyped column would surface).

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260910000001_create_watchlist_tables.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat: add watchlist_entries and watchlist_snapshots table migrations"
```

---

### Task 2: `youtube.ts` gains `getChannelStats`

**Files:**
- Modify: `lib/integrations/youtube.ts`
- Modify: `tests/fakes/youtube.fake.ts`
- Modify: `tests/unit/lib/integrations/youtube.test.ts`

**Interfaces:**
- Consumes: `ChannelNotFoundError` (already in this file), `fetchYouTubeJson` (already in this file)
- Produces: `ChannelStats`, `YouTubeClient.getChannelStats(handle): Promise<ChannelStats>` — relied on by Task 6's handler; `createFakeYouTubeClient`'s new third `channelStats` parameter relied on by Task 6's test

**Why a separate call, not widening `getChannelUploads`'s existing `channels.list`:** `getChannelUploads` already calls `channels.list` with `part=contentDetails` to resolve the uploads playlist. Adding `statistics` to that one call would work too, but would change what every existing caller/test of `getChannelUploads` implicitly depends on the response shape containing. A second, separate `channels.list` call keeps `getChannelUploads`'s contract and all its existing tests completely unchanged.

- [ ] **Step 1: Write the failing test**

In `tests/unit/lib/integrations/youtube.test.ts`, update the import line to include `ChannelNotFoundError`, then add a new `describe` block after the existing `describe('getChannelUploads', ...)` block:
```ts
import { createYouTubeClient, extractYouTubeVideoId, ChannelNotFoundError } from '@/lib/integrations/youtube';
```
```ts
  describe('getChannelStats', () => {
    it('fetches subscriber, view, and video counts by handle', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ statistics: { subscriberCount: '4200', viewCount: '900000', videoCount: '150', hiddenSubscriberCount: false } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createYouTubeClient('test-api-key');
      const stats = await client.getChannelStats('creator');

      expect(stats).toEqual({ subscriberCount: 4200, totalViewCount: 900000, videoCount: 150 });
      expect(String(fetchMock.mock.calls[0][0])).toContain('forHandle=%40creator');
      expect(String(fetchMock.mock.calls[0][0])).toContain('part=statistics');
    });

    it('returns a null subscriberCount when the channel has hidden it', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ statistics: { hiddenSubscriberCount: true, viewCount: '900000', videoCount: '150' } }] }),
        })
      );
      const client = createYouTubeClient('test-api-key');
      const stats = await client.getChannelStats('creator');
      expect(stats.subscriberCount).toBeNull();
    });

    it('throws ChannelNotFoundError when the handle does not resolve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
      const client = createYouTubeClient('test-api-key');
      await expect(client.getChannelStats('nope')).rejects.toThrow(ChannelNotFoundError);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: FAIL with "client.getChannelStats is not a function"

- [ ] **Step 3: Implement**

In `lib/integrations/youtube.ts`, add this export after the `ChannelNotFoundError` class:
```ts
export interface ChannelStats {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
}
```

Add `getChannelStats(handle: string): Promise<ChannelStats>;` to the `YouTubeClient` interface, after `getChannelUploads`:
```ts
export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
  getChannelUploads(handle: string, maxResults?: number): Promise<VideoMetadata[]>;
  /**
   * Channel-level totals (subscribers, lifetime views, video count) — a
   * separate API call from getChannelUploads, which only ever requests
   * contentDetails. See lib/watchlist/handler.ts for the caller.
   */
  getChannelStats(handle: string): Promise<ChannelStats>;
}
```

Add the implementation inside `createYouTubeClient`, after `getChannelUploads`:
```ts
    async getChannelStats(handle: string): Promise<ChannelStats> {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      channelsUrl.searchParams.set('part', 'statistics');
      channelsUrl.searchParams.set('forHandle', cleanHandle);
      channelsUrl.searchParams.set('key', apiKey);
      const data = await fetchYouTubeJson(channelsUrl);
      const channel = data.items?.[0];
      if (!channel) {
        throw new ChannelNotFoundError(handle);
      }
      const stats = channel.statistics ?? {};
      return {
        subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
        totalViewCount: Number(stats.viewCount ?? 0),
        videoCount: Number(stats.videoCount ?? 0),
      };
    },
```

In `tests/fakes/youtube.fake.ts`, add a `ChannelStats` import and a third parameter:
```ts
import type { YouTubeClient, VideoMetadata, ChannelStats } from '@/lib/integrations/youtube';

export function createFakeYouTubeClient(
  overrides: Partial<VideoMetadata> = {},
  channelUploads: VideoMetadata[] = [],
  channelStats: ChannelStats = { subscriberCount: 1000, totalViewCount: 50000, videoCount: 20 }
): YouTubeClient {
  const metadata: VideoMetadata = {
    id: 'fake-video-id',
    title: 'How to hook viewers in 3 seconds',
    description: 'A tutorial about hooks',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 180,
    viewCount: 5000,
    likeCount: 400,
    commentCount: 50,
    tags: ['tutorial'],
    ...overrides,
  };
  return {
    extractVideoId: (url: string) => (url.includes('youtube') ? 'fake-video-id' : null),
    getVideoMetadata: async () => metadata,
    getChannelUploads: async () => channelUploads,
    getChannelStats: async () => channelStats,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — the fake's new third parameter is optional and defaults, so no existing 2-arg caller breaks)

- [ ] **Step 5: Commit**
```bash
git add lib/integrations/youtube.ts tests/fakes/youtube.fake.ts tests/unit/lib/integrations/youtube.test.ts
git commit -m "feat: add getChannelStats to the YouTube integration client"
```

---

### Task 3: `scraper.ts` gains `ProfilePost.followerCount`

**Files:**
- Modify: `lib/integrations/scraper.ts`
- Modify: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `ProfilePost.followerCount?: number` — relied on by Task 6's handler

**Why optional, best-effort:** Apify's TikTok actor exposes a profile's follower count at `authorMeta.fans` and its Instagram actor at `followersCount`, but neither guarantees the field is present on every item in every run. Optional keeps a missing value an honest `undefined` rather than a fabricated `0`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/lib/integrations/scraper.test.ts`, add a new `describe` block after the existing `durationSeconds` test (inside or after the `fetchProfilePosts` describe block):
```ts
  describe('fetchProfilePosts follower count', () => {
    it('extracts followerCount from authorMeta.fans for TikTok', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '1',
              text: 'Post',
              createTimeISO: '2026-08-01T00:00:00Z',
              playCount: 100,
              diggCount: 5,
              commentCount: 1,
              authorMeta: { fans: 42000 },
              webVideoUrl: 'https://www.tiktok.com/@creator/video/1',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts[0].followerCount).toBe(42000);
    });

    it('extracts followerCount from followersCount for Instagram', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '1',
              caption: 'Post',
              timestamp: '2026-08-01T00:00:00Z',
              viewCount: 100,
              likesCount: 5,
              commentCount: 1,
              followersCount: 8000,
              url: 'https://www.instagram.com/p/1/',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('instagram', 'creator');

      expect(posts[0].followerCount).toBe(8000);
    });

    it('leaves followerCount undefined when the actor run did not include one', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: '1', text: 'Post', createTimeISO: '2026-08-01T00:00:00Z', playCount: 100, diggCount: 5, commentCount: 1 }],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts[0].followerCount).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL with "expected undefined to be 42000" (`followerCount` doesn't exist yet)

- [ ] **Step 3: Implement**

In `lib/integrations/scraper.ts`, add `followerCount?: number;` to the `ProfilePost` interface, after `durationSeconds?: number;`:
```ts
export interface ProfilePost {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds?: number;
  followerCount?: number;
  permalink: string;
}
```

Update `normalizeProfilePost` to extract it:
```ts
function normalizeProfilePost(platform: 'tiktok' | 'instagram', item: Record<string, unknown>): ProfilePost {
  const authorMeta = item.authorMeta as Record<string, unknown> | undefined;
  const rawFollowerCount = platform === 'tiktok' ? authorMeta?.fans : item.followersCount;
  return {
    platform,
    id: String(item.id ?? item.videoId ?? item.shortCode ?? ''),
    caption: String(item.text ?? item.caption ?? ''),
    publishedAt: String(item.createTimeISO ?? item.timestamp ?? ''),
    viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
    likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
    commentCount: Number(item.commentCount ?? 0),
    durationSeconds: item.videoDuration !== undefined || item.duration !== undefined
      ? Number(item.videoDuration ?? item.duration ?? 0)
      : undefined,
    followerCount: rawFollowerCount !== undefined ? Number(rawFollowerCount) : undefined,
    permalink: String(item.webVideoUrl ?? item.url ?? item.permalink ?? ''),
  };
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: The three new tests PASS, but the pre-existing `'starts an async Apify run, polls until it succeeds, and normalizes the dataset items'` test now FAILS — its `toEqual` assertion lists an exact object with no `followerCount` key, and this codebase's `toEqual` distinguishes a missing key from an explicit `undefined` value (see the identical situation this file's `durationSeconds` addition caused).

- [ ] **Step 5: Fix the pre-existing test's expectation**

In the same file, find the `'starts an async Apify run...'` test's `expect(posts).toEqual([...])` block and add `followerCount: undefined` alongside the existing `durationSeconds: undefined`:
```ts
      expect(posts).toEqual([
        {
          platform: 'tiktok',
          id: '111',
          caption: 'Post one',
          publishedAt: '2026-08-02T10:00:00Z',
          viewCount: 1000,
          likeCount: 50,
          commentCount: 5,
          durationSeconds: undefined,
          followerCount: undefined,
          permalink: 'https://www.tiktok.com/@creator/video/111',
        },
      ]);
```

- [ ] **Step 6: Run the full file to verify everything passes**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**
```bash
git add lib/integrations/scraper.ts tests/unit/lib/integrations/scraper.test.ts
git commit -m "feat: add best-effort followerCount to ProfilePost"
```

---

### Task 4: `lib/watchlist/types.ts` + `lib/watchlist/aggregate.ts`

**Files:**
- Create: `lib/watchlist/types.ts`
- Create: `lib/watchlist/aggregate.ts`
- Test: `tests/unit/lib/watchlist/aggregate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `WATCHLIST_ENTRY_LIMIT`, `ChannelSnapshotInputPost`, `ChannelSnapshotInput`, `RankedPost`, `SnapshotSummary`, `SnapshotDeltaInput`, `SnapshotDeltas`, `WatchlistEntry`, `WatchlistSnapshot`, `WatchlistEntryView`, `DuplicateWatchlistEntryError`; `computeViewsPerHour(viewCount, publishedAt, now?)`, `buildSnapshotSummary(input, now?)`, `computeDeltas(latest, previous)` — relied on by Tasks 5, 6, 7 (handler), Task 10 (page-state), Task 11 (page)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/watchlist/aggregate.test.ts
import { describe, it, expect } from 'vitest';
import { computeViewsPerHour, buildSnapshotSummary, computeDeltas } from '@/lib/watchlist/aggregate';
import type { ChannelSnapshotInputPost } from '@/lib/watchlist/types';

const NOW = new Date('2026-09-10T12:00:00Z');

function makePost(overrides: Partial<ChannelSnapshotInputPost> = {}): ChannelSnapshotInputPost {
  return {
    captionOrTitle: 'A post',
    url: 'https://example.com/post',
    viewCount: 1000,
    publishedAt: '2026-09-10T02:00:00Z', // 10 hours before NOW
    ...overrides,
  };
}

describe('computeViewsPerHour', () => {
  it('divides views by hours elapsed since publishing', () => {
    expect(computeViewsPerHour(1000, '2026-09-10T02:00:00Z', NOW)).toBe(100);
  });

  it('floors elapsed time at 1 hour for a post published less than an hour ago', () => {
    expect(computeViewsPerHour(500, '2026-09-10T11:45:00Z', NOW)).toBe(500);
  });
});

describe('buildSnapshotSummary', () => {
  it('ranks posts by views-per-hour descending and keeps only the top 5', () => {
    const posts = [
      makePost({ captionOrTitle: 'Slow', viewCount: 100, publishedAt: '2026-09-10T02:00:00Z' }), // 10/hr
      makePost({ captionOrTitle: 'Fast', viewCount: 900, publishedAt: '2026-09-10T11:00:00Z' }), // 900/hr
      makePost({ captionOrTitle: 'Mid A', viewCount: 200, publishedAt: '2026-09-10T10:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Mid B', viewCount: 300, publishedAt: '2026-09-10T09:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Mid C', viewCount: 400, publishedAt: '2026-09-10T08:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Sixth', viewCount: 50, publishedAt: '2026-09-10T04:00:00Z' }), // 6.25/hr, dropped
    ];
    const summary = buildSnapshotSummary({ subscriberCount: 5000, totalViewCount: 100000, videoCount: 40, posts }, NOW);
    expect(summary.topPosts).toHaveLength(5);
    expect(summary.topPosts[0].captionOrTitle).toBe('Fast');
    expect(summary.topPosts.map((p) => p.captionOrTitle)).not.toContain('Sixth');
  });

  it('returns fewer than 5 posts when fewer than 5 were fetched', () => {
    const summary = buildSnapshotSummary(
      { subscriberCount: 100, totalViewCount: 1000, videoCount: 2, posts: [makePost(), makePost()] },
      NOW
    );
    expect(summary.topPosts).toHaveLength(2);
  });

  it('passes subscriberCount, totalViewCount, and videoCount through unchanged', () => {
    const summary = buildSnapshotSummary({ subscriberCount: null, totalViewCount: 5000, videoCount: 12, posts: [] }, NOW);
    expect(summary).toEqual({ subscriberCount: null, totalViewCount: 5000, videoCount: 12, topPosts: [] });
  });
});

describe('computeDeltas', () => {
  it('returns all-null deltas when there is no prior snapshot', () => {
    expect(computeDeltas({ subscriberCount: 100, totalViewCount: 1000, videoCount: 5 }, null)).toEqual({
      subscriberDelta: null,
      totalViewDelta: null,
      videoDelta: null,
      comparedAgainstCapturedAt: null,
    });
  });

  it('computes deltas against a prior snapshot', () => {
    const result = computeDeltas(
      { subscriberCount: 1200, totalViewCount: 50000, videoCount: 42 },
      { subscriberCount: 1000, totalViewCount: 40000, videoCount: 40, capturedAt: '2026-09-03T12:00:00Z' }
    );
    expect(result).toEqual({
      subscriberDelta: 200,
      totalViewDelta: 10000,
      videoDelta: 2,
      comparedAgainstCapturedAt: '2026-09-03T12:00:00Z',
    });
  });

  it('returns a null subscriberDelta when either side has a hidden subscriber count, but still computes view/video deltas', () => {
    const result = computeDeltas(
      { subscriberCount: null, totalViewCount: 50000, videoCount: 42 },
      { subscriberCount: 1000, totalViewCount: 40000, videoCount: 40, capturedAt: '2026-09-03T12:00:00Z' }
    );
    expect(result.subscriberDelta).toBeNull();
    expect(result.totalViewDelta).toBe(10000);
    expect(result.videoDelta).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/watchlist/aggregate.test.ts`
Expected: FAIL with "Cannot find module '@/lib/watchlist/aggregate'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/watchlist/types.ts
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
```
```ts
// lib/watchlist/aggregate.ts
import type { ChannelSnapshotInput, RankedPost, SnapshotSummary, SnapshotDeltaInput, SnapshotDeltas } from './types';

const TOP_POSTS_LIMIT = 5;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * A post published less than an hour ago uses a 1-hour floor rather than the
 * true elapsed time, so a brand-new upload doesn't produce an artificially
 * explosive (or Infinity, at t=0) views-per-hour figure.
 */
export function computeViewsPerHour(viewCount: number, publishedAt: string, now: Date = new Date()): number {
  const publishedMs = new Date(publishedAt).getTime();
  const hoursElapsed = Math.max((now.getTime() - publishedMs) / MS_PER_HOUR, 1);
  return viewCount / hoursElapsed;
}

export function buildSnapshotSummary(input: ChannelSnapshotInput, now: Date = new Date()): SnapshotSummary {
  const ranked: RankedPost[] = input.posts
    .map((post) => ({ ...post, viewsPerHour: computeViewsPerHour(post.viewCount, post.publishedAt, now) }))
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour)
    .slice(0, TOP_POSTS_LIMIT);

  return {
    subscriberCount: input.subscriberCount,
    totalViewCount: input.totalViewCount,
    videoCount: input.videoCount,
    topPosts: ranked,
  };
}

export function computeDeltas(
  latest: SnapshotDeltaInput,
  previous: (SnapshotDeltaInput & { capturedAt: string }) | null
): SnapshotDeltas {
  if (!previous) {
    return { subscriberDelta: null, totalViewDelta: null, videoDelta: null, comparedAgainstCapturedAt: null };
  }
  return {
    subscriberDelta:
      latest.subscriberCount !== null && previous.subscriberCount !== null
        ? latest.subscriberCount - previous.subscriberCount
        : null,
    totalViewDelta: latest.totalViewCount - previous.totalViewCount,
    videoDelta: latest.videoCount - previous.videoCount,
    comparedAgainstCapturedAt: previous.capturedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/watchlist/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/watchlist/types.ts lib/watchlist/aggregate.ts tests/unit/lib/watchlist/aggregate.test.ts
git commit -m "feat: add watchlist shared types and views-per-hour/delta aggregation"
```

---

### Task 5: `lib/watchlist/handler.ts` — `handleAddWatchlistEntry`

**Files:**
- Create: `lib/watchlist/handler.ts`
- Test: `tests/unit/lib/watchlist/handler.test.ts`

**Interfaces:**
- Consumes: `detectHandlePlatform`/`normalizeHandle` (`@/lib/recap/handles`), `DuplicateWatchlistEntryError`/`WATCHLIST_ENTRY_LIMIT`/`WatchlistEntry`/`WatchlistEntryView` (Task 4)
- Produces: `WatchlistHandlerResult`, `AddWatchlistEntryDeps`, `AddWatchlistEntryContext`, `handleAddWatchlistEntry(deps, context)` — relied on by Task 8's route; the `makeDeps()` in-memory test helper introduced here is extended by Tasks 6 and 7 in the same test file

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/watchlist/handler.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/watchlist/handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/watchlist/handler.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/watchlist/handler.ts tests/unit/lib/watchlist/handler.test.ts
git commit -m "feat: add handleAddWatchlistEntry"
```

---

### Task 6: `lib/watchlist/handler.ts` — `handleListWatchlist`

**Files:**
- Modify: `lib/watchlist/handler.ts`
- Modify: `tests/unit/lib/watchlist/handler.test.ts`

**Interfaces:**
- Consumes: `checkAndRecordRateLimit`/`releaseRateLimitEventIfNeeded`/`hashIp`/`RateLimitStore` (`@/lib/rate-limit`), `ChannelNotFoundError`/`YouTubeClient` (`@/lib/integrations/youtube`), `ScraperClient` (`@/lib/integrations/scraper`), `buildSnapshotSummary`/`computeDeltas` (Task 4), `toEntryView` (Task 5, same file)
- Produces: `ListWatchlistDeps`, `ListWatchlistContext`, `handleListWatchlist(deps, context)`, `WATCHLIST_SNAPSHOT_TTL_HOURS`, `WATCHLIST_REFRESH_PROFILE_LIMIT`, `WATCHLIST_REFRESH_IP_LIMIT` — relied on by Task 8's route

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/watchlist/handler.test.ts`:
```ts
import { handleListWatchlist, WATCHLIST_REFRESH_PROFILE_LIMIT } from '@/lib/watchlist/handler';
import type { VideoMetadata } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';
```
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: FAIL with "handleListWatchlist is not a function" / import error

- [ ] **Step 3: Write minimal implementation**

Add these imports to the top of `lib/watchlist/handler.ts` (extend the existing `type` import list to also include `ChannelSnapshotInputPost`, already imported — no change needed there since Task 5 already imports it as a type-only import even though it wasn't used yet; if your editor flags it as unused after Task 5, that's expected until this task uses it).

Append to `lib/watchlist/handler.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/watchlist/handler.ts tests/unit/lib/watchlist/handler.test.ts
git commit -m "feat: add handleListWatchlist with refresh-on-visit, deltas, and refresh rate limiting"
```

---

### Task 7: `lib/watchlist/handler.ts` — `handleRemoveWatchlistEntry`

**Files:**
- Modify: `lib/watchlist/handler.ts`
- Modify: `tests/unit/lib/watchlist/handler.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `RemoveWatchlistEntryDeps`, `RemoveWatchlistEntryContext`, `handleRemoveWatchlistEntry(deps, context)` — relied on by Task 9's route

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/watchlist/handler.test.ts`:
```ts
import { handleRemoveWatchlistEntry } from '@/lib/watchlist/handler';
```
```ts
describe('handleRemoveWatchlistEntry', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleRemoveWatchlistEntry(makeDeps(), { profileId: null, entryId: 'entry-1' });
    expect(result.status).toBe(401);
  });

  it('removes an entry the profile owns', async () => {
    const deps = makeDeps();
    const added = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    const entryId = (added.body.entry as { id: string }).id;

    const result = await handleRemoveWatchlistEntry(deps, { profileId: 'p1', entryId });
    expect(result.status).toBe(204);
    expect(await deps.listEntries('p1')).toEqual([]);
  });

  it('returns 404 for an entry that does not exist or belongs to someone else', async () => {
    const deps = makeDeps();
    const added = await handleAddWatchlistEntry(deps, { profileId: 'p1', url: 'https://www.youtube.com/@creator' });
    const entryId = (added.body.entry as { id: string }).id;

    const result = await handleRemoveWatchlistEntry(deps, { profileId: 'someone-else', entryId });
    expect(result.status).toBe(404);
    expect(await deps.listEntries('p1')).toHaveLength(1); // untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: FAIL with "handleRemoveWatchlistEntry is not a function" / import error

- [ ] **Step 3: Write minimal implementation**

Append to `lib/watchlist/handler.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/watchlist/handler.test.ts`
Expected: PASS (the full file — all of Tasks 5, 6, 7's tests)

- [ ] **Step 5: Commit**
```bash
git add lib/watchlist/handler.ts tests/unit/lib/watchlist/handler.test.ts
git commit -m "feat: add handleRemoveWatchlistEntry"
```

---

### Task 8: `GET`/`POST /api/watchlist` route

**Files:**
- Create: `app/api/watchlist/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (`@/lib/supabase/server`), `createSupabaseRateLimitStore` (`@/lib/supabase/rate-limit-store`), `createYouTubeClient` (`@/lib/integrations/youtube`), `createApifyScraperClient` (`@/lib/integrations/scraper`), `deriveClientIp` (`@/lib/ip`), `handleAddWatchlistEntry`/`handleListWatchlist` (Tasks 5, 6), `hasActiveSubscription` (`@/lib/billing/entitlements`), `DuplicateWatchlistEntryError`/`WatchlistEntry`/`WatchlistSnapshot` (Task 4), the `watchlist_entries`/`watchlist_snapshots` Database types (Task 1)
- Produces: `GET`/`POST` handlers for `/api/watchlist` — no dedicated unit test (thin wiring, per this repo's convention); exercised by Task 13's E2E test

No test file for this task — per this repo's convention, routes are thin wiring verified by the handler's own unit tests (Tasks 5, 6) plus the E2E test (Task 13). Verification for this task is `npx tsc --noEmit` passing.

- [ ] **Step 1: Write the route**
```ts
// app/api/watchlist/route.ts
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { deriveClientIp } from '@/lib/ip';
import { handleAddWatchlistEntry, handleListWatchlist } from '@/lib/watchlist/handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { DuplicateWatchlistEntryError, type WatchlistEntry, type WatchlistSnapshot } from '@/lib/watchlist/types';
import type { Database } from '@/lib/supabase/types';

const UNIQUE_VIOLATION = '23505';

function mapEntryRow(row: Database['public']['Tables']['watchlist_entries']['Row']): WatchlistEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    platform: row.platform,
    handle: row.handle,
    url: row.url,
    label: row.label,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function mapSnapshotRow(row: Database['public']['Tables']['watchlist_snapshots']['Row']): WatchlistSnapshot {
  return {
    entryId: row.entry_id,
    capturedAt: row.captured_at,
    subscriberCount: row.subscriber_count,
    totalViewCount: row.total_view_count,
    videoCount: row.video_count,
    topPosts: row.top_posts as WatchlistSnapshot['topPosts'],
  };
}

function buildDeps(serviceClient: SupabaseClient<Database>) {
  return {
    youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
    scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
    rateLimitStore: createSupabaseRateLimitStore(serviceClient),
    ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
    hasActiveSubscription: (profileId: string) => hasActiveSubscription(serviceClient, profileId),
    countEntries: async (profileId: string) => {
      const { count, error } = await serviceClient
        .from('watchlist_entries')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId);
      if (error) throw new Error(`Failed to count watchlist entries: ${error.message}`);
      return count ?? 0;
    },
    insertEntry: async (params: { profileId: string; platform: WatchlistEntry['platform']; handle: string; url: string; label: string | null }) => {
      const { data, error } = await serviceClient
        .from('watchlist_entries')
        .insert({ profile_id: params.profileId, platform: params.platform, handle: params.handle, url: params.url, label: params.label })
        .select('*')
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        throw new DuplicateWatchlistEntryError();
      }
      if (error || !data) {
        throw new Error(`Failed to add watchlist entry: ${error?.message}`);
      }
      return mapEntryRow(data);
    },
    listEntries: async (profileId: string) => {
      const { data, error } = await serviceClient
        .from('watchlist_entries')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Failed to list watchlist entries: ${error.message}`);
      return (data ?? []).map(mapEntryRow);
    },
    getLatestSnapshot: async (entryId: string) => {
      const { data, error } = await serviceClient
        .from('watchlist_snapshots')
        .select('*')
        .eq('entry_id', entryId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch latest snapshot: ${error.message}`);
      return data ? mapSnapshotRow(data) : null;
    },
    getSnapshotAtOrBefore: async (entryId: string, cutoff: Date) => {
      const { data, error } = await serviceClient
        .from('watchlist_snapshots')
        .select('*')
        .eq('entry_id', entryId)
        .lte('captured_at', cutoff.toISOString())
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch historical snapshot: ${error.message}`);
      return data ? mapSnapshotRow(data) : null;
    },
    insertSnapshot: async (snapshot: WatchlistSnapshot) => {
      const { error } = await serviceClient.from('watchlist_snapshots').insert({
        entry_id: snapshot.entryId,
        captured_at: snapshot.capturedAt,
        subscriber_count: snapshot.subscriberCount,
        total_view_count: snapshot.totalViewCount,
        video_count: snapshot.videoCount,
        top_posts: snapshot.topPosts,
      });
      if (error) throw new Error(`Failed to save watchlist snapshot: ${error.message}`);
    },
    clearEntryError: async (entryId: string) => {
      const { error } = await serviceClient.from('watchlist_entries').update({ last_error: null }).eq('id', entryId);
      if (error) throw new Error(`Failed to clear watchlist entry error: ${error.message}`);
    },
    setEntryError: async (entryId: string, message: string) => {
      const { error } = await serviceClient.from('watchlist_entries').update({ last_error: message }).eq('id', entryId);
      if (error) throw new Error(`Failed to record watchlist entry error: ${error.message}`);
    },
  };
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const ip = deriveClientIp({
    headers: request.headers,
    isTrustedPlatform: process.env.VERCEL === '1',
    trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
  });

  const result = await handleListWatchlist(buildDeps(serviceClient), { profileId: user?.id ?? null, ip, now: new Date() });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  try {
    const { url, label } = (await request.json()) as { url?: string; label?: string };
    if (!url) {
      return NextResponse.json({ error: 'A channel or profile URL is required.' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();

    const result = await handleAddWatchlistEntry(buildDeps(serviceClient), { profileId: user?.id ?? null, url, label });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Adding a watchlist entry failed:', err);
    return NextResponse.json({ error: 'Something went wrong adding that competitor. Please try again.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**
```bash
git add app/api/watchlist/route.ts
git commit -m "feat: add GET/POST /api/watchlist route"
```

---

### Task 9: `DELETE /api/watchlist/[id]` route

**Files:**
- Create: `app/api/watchlist/[id]/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (`@/lib/supabase/server`), `handleRemoveWatchlistEntry` (Task 7)
- Produces: `DELETE` handler for `/api/watchlist/[id]` — no dedicated unit test; exercised by Task 13's E2E test

- [ ] **Step 1: Write the route**
```ts
// app/api/watchlist/[id]/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleRemoveWatchlistEntry } from '@/lib/watchlist/handler';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleRemoveWatchlistEntry(
    {
      deleteEntry: async (profileId: string, entryId: string) => {
        const { error, count } = await serviceClient
          .from('watchlist_entries')
          .delete({ count: 'exact' })
          .eq('id', entryId)
          .eq('profile_id', profileId);
        if (error) throw new Error(`Failed to remove watchlist entry: ${error.message}`);
        return (count ?? 0) > 0;
      },
    },
    { profileId: user?.id ?? null, entryId: params.id }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**
```bash
git add app/api/watchlist/\[id\]/route.ts
git commit -m "feat: add DELETE /api/watchlist/[id] route"
```

---

### Task 10: `lib/watchlist/page-state.ts`

**Files:**
- Create: `lib/watchlist/page-state.ts`
- Test: `tests/unit/lib/watchlist/page-state.test.ts`

**Interfaces:**
- Consumes: `isValidEmailFormat` (`@/lib/auth/sign-in-flow-state`), `WATCHLIST_ENTRY_LIMIT`/`WatchlistEntryView` (Task 4)
- Produces: `WatchlistPageState`, `WatchlistPageEvent`, `createInitialWatchlistPageState()`, `watchlistPageReducer(state, event)`, re-exported `WATCHLIST_ENTRY_LIMIT` — relied on by Task 11's page

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/watchlist/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { watchlistPageReducer, createInitialWatchlistPageState } from '@/lib/watchlist/page-state';
import type { WatchlistEntryView } from '@/lib/watchlist/types';

function makeEntry(overrides: Partial<WatchlistEntryView> = {}): WatchlistEntryView {
  return {
    id: 'entry-1',
    platform: 'youtube',
    handle: 'creator',
    url: 'https://www.youtube.com/@creator',
    label: null,
    lastError: null,
    hasSnapshot: true,
    subscriberCount: 1000,
    totalViewCount: 50000,
    videoCount: 20,
    topPosts: [],
    sevenDayDelta: null,
    thirtyDayDelta: null,
    ...overrides,
  };
}

describe('watchlistPageReducer', () => {
  it('starts in the loading state', () => {
    expect(createInitialWatchlistPageState()).toEqual({ status: 'loading' });
  });

  it('moves to loaded on BOOTSTRAPPED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), {
      type: 'BOOTSTRAPPED',
      entries: [makeEntry()],
      subscriptionRequired: false,
    });
    expect(state).toEqual({
      status: 'loaded',
      entries: [makeEntry()],
      subscriptionRequired: false,
      addUrl: '',
      addLabel: '',
      adding: false,
      addStillWorking: false,
      addError: null,
      removingEntryId: null,
      removeError: null,
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('degrades to an empty loaded state on BOOTSTRAP_FAILED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_FAILED' });
    expect(state.status).toBe('loaded');
    expect((state as any).entries).toEqual([]);
  });

  describe('from a loaded state', () => {
    const loaded = watchlistPageReducer(createInitialWatchlistPageState(), {
      type: 'BOOTSTRAPPED',
      entries: [],
      subscriptionRequired: false,
    });

    it('updates addUrl on ADD_URL_CHANGED', () => {
      const next = watchlistPageReducer(loaded, { type: 'ADD_URL_CHANGED', value: 'https://tiktok.com/@x' });
      expect((next as any).addUrl).toBe('https://tiktok.com/@x');
    });

    it('ignores ADD_URL_CHANGED while adding is in flight', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_URL_CHANGED', value: 'https://tiktok.com/@x' });
      expect((next as any).addUrl).toBe('');
    });

    it('sets adding true on ADD_SUBMIT', () => {
      const next = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      expect((next as any).adding).toBe(true);
    });

    it('resets add fields and updates entries on ADD_SUCCESS', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_SUCCESS', entries: [makeEntry()], subscriptionRequired: true });
      expect((next as any).adding).toBe(false);
      expect((next as any).entries).toEqual([makeEntry()]);
      expect((next as any).subscriptionRequired).toBe(true);
      expect((next as any).addUrl).toBe('');
    });

    it('sets addError and clears adding on ADD_FAILED', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_FAILED', error: 'Nope' });
      expect((next as any).adding).toBe(false);
      expect((next as any).addError).toBe('Nope');
    });

    it('sets removingEntryId on REMOVE_REQUESTED and clears it on REMOVE_SUCCESS, filtering the entry out', () => {
      const withEntry = watchlistPageReducer(createInitialWatchlistPageState(), {
        type: 'BOOTSTRAPPED',
        entries: [makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })],
        subscriptionRequired: false,
      });
      const removing = watchlistPageReducer(withEntry, { type: 'REMOVE_REQUESTED', entryId: 'entry-1' });
      expect((removing as any).removingEntryId).toBe('entry-1');
      const removed = watchlistPageReducer(removing, { type: 'REMOVE_SUCCESS', entryId: 'entry-1' });
      expect((removed as any).removingEntryId).toBeNull();
      expect((removed as any).entries.map((e: WatchlistEntryView) => e.id)).toEqual(['entry-2']);
    });

    it('sets removeError and clears removingEntryId on REMOVE_FAILED', () => {
      const removing = watchlistPageReducer(loaded, { type: 'REMOVE_REQUESTED', entryId: 'entry-1' });
      const failed = watchlistPageReducer(removing, { type: 'REMOVE_FAILED', error: 'Could not remove' });
      expect((failed as any).removingEntryId).toBeNull();
      expect((failed as any).removeError).toBe('Could not remove');
    });
  });

  describe('sign-in sub-flow', () => {
    it('moves through email change, submit, and magic link sent', () => {
      const needsSignIn = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
      const emailEntered = watchlistPageReducer(needsSignIn, { type: 'EMAIL_CHANGED', email: 'jordan@example.com' });
      const submitting = watchlistPageReducer(emailEntered, { type: 'SUBMIT_EMAIL' });
      expect(submitting).toEqual({ status: 'submittingMagicLink', email: 'jordan@example.com' });
      const sent = watchlistPageReducer(submitting, { type: 'MAGIC_LINK_SENT' });
      expect(sent).toEqual({ status: 'checkEmail', email: 'jordan@example.com' });
    });

    it('ignores SUBMIT_EMAIL for an invalid email format', () => {
      const needsSignIn = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
      const emailEntered = watchlistPageReducer(needsSignIn, { type: 'EMAIL_CHANGED', email: 'not-an-email' });
      const result = watchlistPageReducer(emailEntered, { type: 'SUBMIT_EMAIL' });
      expect(result.status).toBe('needsSignIn');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/watchlist/page-state.test.ts`
Expected: FAIL with "Cannot find module '@/lib/watchlist/page-state'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/watchlist/page-state.ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import { WATCHLIST_ENTRY_LIMIT, type WatchlistEntryView } from './types';

export { WATCHLIST_ENTRY_LIMIT };

export type WatchlistPageState =
  | { status: 'loading' }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string }
  | {
      status: 'loaded';
      entries: WatchlistEntryView[];
      subscriptionRequired: boolean;
      addUrl: string;
      addLabel: string;
      adding: boolean;
      addStillWorking: boolean;
      addError: string | null;
      removingEntryId: string | null;
      removeError: string | null;
    };

export type WatchlistPageEvent =
  | { type: 'BOOTSTRAPPED'; entries: WatchlistEntryView[]; subscriptionRequired: boolean }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'ADD_URL_CHANGED'; value: string }
  | { type: 'ADD_LABEL_CHANGED'; value: string }
  | { type: 'ADD_SUBMIT' }
  | { type: 'ADD_STILL_WORKING' }
  | { type: 'ADD_SUCCESS'; entries: WatchlistEntryView[]; subscriptionRequired: boolean }
  | { type: 'ADD_FAILED'; error: string }
  | { type: 'REMOVE_REQUESTED'; entryId: string }
  | { type: 'REMOVE_SUCCESS'; entryId: string }
  | { type: 'REMOVE_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialWatchlistPageState(): WatchlistPageState {
  return { status: 'loading' };
}

export function watchlistPageReducer(state: WatchlistPageState, event: WatchlistPageEvent): WatchlistPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return {
        status: 'loaded',
        entries: event.entries,
        subscriptionRequired: event.subscriptionRequired,
        addUrl: '',
        addLabel: '',
        adding: false,
        addStillWorking: false,
        addError: null,
        removingEntryId: null,
        removeError: null,
      };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'loaded',
        entries: [],
        subscriptionRequired: false,
        addUrl: '',
        addLabel: '',
        adding: false,
        addStillWorking: false,
        addError: null,
        removingEntryId: null,
        removeError: null,
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'ADD_URL_CHANGED':
      return state.status === 'loaded' && !state.adding ? { ...state, addUrl: event.value } : state;

    case 'ADD_LABEL_CHANGED':
      return state.status === 'loaded' && !state.adding ? { ...state, addLabel: event.value } : state;

    case 'ADD_SUBMIT':
      return state.status === 'loaded' && !state.adding
        ? { ...state, adding: true, addStillWorking: false, addError: null }
        : state;

    case 'ADD_STILL_WORKING':
      return state.status === 'loaded' && state.adding ? { ...state, addStillWorking: true } : state;

    case 'ADD_SUCCESS':
      return state.status === 'loaded'
        ? {
            ...state,
            entries: event.entries,
            subscriptionRequired: event.subscriptionRequired,
            addUrl: '',
            addLabel: '',
            adding: false,
            addStillWorking: false,
            addError: null,
          }
        : state;

    case 'ADD_FAILED':
      return state.status === 'loaded' ? { ...state, adding: false, addStillWorking: false, addError: event.error } : state;

    case 'REMOVE_REQUESTED':
      return state.status === 'loaded' && !state.removingEntryId
        ? { ...state, removingEntryId: event.entryId, removeError: null }
        : state;

    case 'REMOVE_SUCCESS':
      return state.status === 'loaded'
        ? { ...state, entries: state.entries.filter((e) => e.id !== event.entryId), removingEntryId: null }
        : state;

    case 'REMOVE_FAILED':
      return state.status === 'loaded' ? { ...state, removingEntryId: null, removeError: event.error } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError' ? { ...state, email: event.email } : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/watchlist/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/watchlist/page-state.ts tests/unit/lib/watchlist/page-state.test.ts
git commit -m "feat: add watchlist page state machine"
```

---

### Task 11: `app/watchlist/page.tsx`

**Files:**
- Create: `app/watchlist/page.tsx`
- Test: `tests/unit/app/watchlist/page.test.tsx`

**Interfaces:**
- Consumes: `AppNav` (`@/components/AppNav`), `Spinner` (`@/components/Spinner`), `SignInPrompt` (`@/components/SignInPrompt`), `watchlistPageReducer`/`createInitialWatchlistPageState`/`WATCHLIST_ENTRY_LIMIT` (Task 10)
- Produces: `WatchlistPage` default export — exercised by Task 13's E2E test

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/watchlist/page.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import WatchlistPage from '@/app/watchlist/page';

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('WatchlistPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a sign-in prompt when the bootstrap GET returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'You must be signed in.' }, 401)));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('renders existing entries after a successful bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: 'Main rival',
              lastError: null,
              hasSnapshot: true,
              subscriberCount: 4200,
              totalViewCount: 900000,
              videoCount: 150,
              topPosts: [{ captionOrTitle: 'A great video', url: 'https://youtu.be/x', viewCount: 5000, publishedAt: '2026-09-09T00:00:00Z', viewsPerHour: 200 }],
              sevenDayDelta: { subscriberDelta: 100, totalViewDelta: 5000, videoDelta: 1, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('Main rival')).toBeInTheDocument());
    expect(screen.getByText('4,200')).toBeInTheDocument();
  });

  it('shows the upgrade banner when subscriptionRequired is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries: [], subscriptionRequired: true })));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText(/upgrade to keep this watchlist refreshed/i)).toBeInTheDocument());
  });

  it('disables the add form once the 20-competitor cap is reached', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `entry-${i}`,
      platform: 'youtube',
      handle: `creator${i}`,
      url: `https://www.youtube.com/@creator${i}`,
      label: null,
      lastError: null,
      hasSnapshot: false,
      subscriberCount: null,
      totalViewCount: null,
      videoCount: null,
      topPosts: [],
      sevenDayDelta: null,
      thirtyDayDelta: null,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries, subscriptionRequired: false })));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add competitor/i })).toBeDisabled());
  });

  describe('adding a competitor', () => {
    beforeEach(() => {
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/watchlist' && (!init || init.method === undefined)) {
          return Promise.resolve(jsonResponse({ entries: [], subscriptionRequired: false }));
        }
        if (url === '/api/watchlist' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ entry: { id: 'entry-new' } }));
        }
        return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500));
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    it('shows an error and keeps the form usable when adding fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return Promise.resolve(jsonResponse({ error: 'That link is not supported.' }, 400));
          }
          return Promise.resolve(jsonResponse({ entries: [], subscriptionRequired: false }));
        })
      );
      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://example.com/x' } });
      fireEvent.click(screen.getByRole('button', { name: /add competitor/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That link is not supported.'));
    });
  });

  it('removes an entry from the list when the remove button succeeds', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      return Promise.resolve(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: null,
              lastError: null,
              hasSnapshot: false,
              subscriberCount: null,
              totalViewCount: null,
              videoCount: null,
              topPosts: [],
              sevenDayDelta: null,
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('@creator')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.getByText(/no competitors tracked yet/i)).toBeInTheDocument());
  });

  it('shows an entry-level error message instead of stats when lastError is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: null,
              lastError: "We couldn't find this channel anymore — it may have been renamed or removed.",
              hasSnapshot: false,
              subscriberCount: null,
              totalViewCount: null,
              videoCount: null,
              topPosts: [],
              sevenDayDelta: null,
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText(/renamed or removed/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/watchlist/page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/watchlist/page'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/watchlist/page.tsx
'use client';

import { useEffect, useReducer, useRef } from 'react';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { watchlistPageReducer, createInitialWatchlistPageState, WATCHLIST_ENTRY_LIMIT } from '@/lib/watchlist/page-state';

export default function WatchlistPage() {
  const [state, dispatch] = useReducer(watchlistPageReducer, createInitialWatchlistPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/watchlist')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        dispatch({ type: 'BOOTSTRAPPED', entries: data.entries ?? [], subscriptionRequired: data.subscriptionRequired ?? false });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdding = state.status === 'loaded' && state.adding;
  useEffect(() => {
    if (!isAdding) return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'ADD_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [isAdding]);

  async function submitAdd(url: string, label: string) {
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: label || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'ADD_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      const refreshed = await fetch('/api/watchlist');
      const refreshedData = await refreshed.json();
      dispatch({
        type: 'ADD_SUCCESS',
        entries: refreshedData.entries ?? [],
        subscriptionRequired: refreshedData.subscriptionRequired ?? false,
      });
    } catch {
      dispatch({ type: 'ADD_FAILED', error: 'Something went wrong on our end. Try again in a moment.' });
    }
  }

  async function submitRemove(entryId: string) {
    try {
      const response = await fetch(`/api/watchlist/${entryId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        dispatch({ type: 'REMOVE_FAILED', error: data.error ?? 'Something went wrong removing that competitor.' });
        return;
      }
      dispatch({ type: 'REMOVE_SUCCESS', entryId });
    } catch {
      dispatch({ type: 'REMOVE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/watchlist' }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'MAGIC_LINK_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'MAGIC_LINK_SENT' });
    } catch {
      dispatch({ type: 'MAGIC_LINK_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'loaded' || state.adding) return;
    const { addUrl, addLabel } = state;
    dispatch({ type: 'ADD_SUBMIT' });
    void submitAdd(addUrl, addLabel);
  }

  if (state.status === 'loading') {
    return <p>Loading…</p>;
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Competitor watchlist</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to build your competitor watchlist."
          returnCopy="Click it to continue and we'll bring you right back here."
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email);
          }}
          onResend={() => {
            const { email } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      </main>
    );
  }

  const atCap = state.entries.length >= WATCHLIST_ENTRY_LIMIT;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Competitor watchlist</h1>
          <p className="mt-1 text-gray-600">
            Track up to {WATCHLIST_ENTRY_LIMIT} channels you&apos;re competing with — subscribers, views, and their
            best-performing posts.
          </p>
        </div>

        {state.subscriptionRequired && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Upgrade to keep this watchlist refreshed.{' '}
            <a href="/billing" className="font-semibold underline">
              See plans
            </a>
          </div>
        )}

        <form onSubmit={handleAddSubmit} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="competitor-url" className="text-sm font-medium text-gray-700">
              Channel or profile link
            </label>
            <input
              id="competitor-url"
              type="url"
              required
              value={state.addUrl}
              onChange={(e) => dispatch({ type: 'ADD_URL_CHANGED', value: e.target.value })}
              disabled={state.adding || atCap}
              placeholder="https://www.youtube.com/@channel"
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="competitor-label" className="text-sm font-medium text-gray-700">
              Label (optional)
            </label>
            <input
              id="competitor-label"
              type="text"
              value={state.addLabel}
              onChange={(e) => dispatch({ type: 'ADD_LABEL_CHANGED', value: e.target.value })}
              disabled={state.adding || atCap}
              placeholder="Main rival"
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={state.adding || atCap}
            title={atCap ? `You've reached the ${WATCHLIST_ENTRY_LIMIT}-competitor limit.` : undefined}
            className="rounded-full bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.adding ? <Spinner label={state.addStillWorking ? 'Still checking their channel…' : 'Adding…'} /> : 'Add competitor'}
          </button>
        </form>
        {state.addError && (
          <p role="alert" className="text-sm text-red-600">
            {state.addError}
          </p>
        )}
        {state.removeError && (
          <p role="alert" className="text-sm text-red-600">
            {state.removeError}
          </p>
        )}

        {state.entries.length === 0 ? (
          <p className="text-gray-500">No competitors tracked yet — add a channel above to get started.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">{entry.label || `@${entry.handle}`}</p>
                    <p className="text-xs text-gray-500">
                      {entry.platform} · @{entry.handle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'REMOVE_REQUESTED', entryId: entry.id });
                      void submitRemove(entry.id);
                    }}
                    disabled={state.removingEntryId === entry.id}
                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    {state.removingEntryId === entry.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>

                {entry.lastError ? (
                  <p className="mt-2 text-sm text-amber-700">{entry.lastError}</p>
                ) : !entry.hasSnapshot ? (
                  <p className="mt-2 text-sm text-gray-500">Fetching first snapshot…</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat label="Subscribers" value={entry.subscriberCount} delta={entry.sevenDayDelta?.subscriberDelta ?? null} />
                    <Stat label="Total views" value={entry.totalViewCount} delta={entry.sevenDayDelta?.totalViewDelta ?? null} />
                    <Stat label="Videos" value={entry.videoCount} delta={entry.sevenDayDelta?.videoDelta ?? null} />
                  </div>
                )}

                {entry.hasSnapshot && entry.topPosts.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-indigo-700">View top posts</summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {entry.topPosts.map((post) => (
                        <li key={post.url} className="text-sm text-gray-700">
                          <a href={post.url} className="underline hover:text-indigo-700" target="_blank" rel="noreferrer">
                            {post.captionOrTitle}
                          </a>{' '}
                          <span className="text-gray-500">— {Math.round(post.viewsPerHour).toLocaleString()} views/hr</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, delta }: { label: string; value: number | null; delta: number | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">
        {value === null ? '—' : value.toLocaleString()}
        {delta !== null && (
          <span className={`ml-2 text-sm font-normal ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toLocaleString()} this week
          </span>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/watchlist/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/watchlist/page.tsx tests/unit/app/watchlist/page.test.tsx
git commit -m "feat: build the competitor watchlist page"
```

---

### Task 12: Landing page + `AppNav` link

**Files:**
- Modify: `app/page.tsx`
- Modify: `tests/unit/app/page-content.test.tsx`
- Modify: `components/AppNav.tsx`
- Modify: `tests/unit/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: a `/watchlist` link on the marketing page and in the signed-in nav

- [ ] **Step 1: Write the failing tests**

Append to `describe('MarketingPage content (signed out)', ...)` in `tests/unit/app/page-content.test.tsx`:
```ts
  it('links to the competitor watchlist tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /track your competitors/i })).toHaveAttribute('href', '/watchlist');
  });
```

Append to `tests/unit/components/AppNav.test.tsx`, after the existing `'includes a Strategy link'` test:
```tsx
  it('includes a Watchlist link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Watchlist' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Watchlist' })).toHaveAttribute('href', '/watchlist');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: FAIL — no link named "Track your competitors" / no link named "Watchlist"

- [ ] **Step 3: Implement**

In `app/page.tsx`, add a new `Link` after the existing `/linkedin` link:
```tsx
      <Link href="/linkedin" className="text-indigo-700 underline">
        Build a LinkedIn content strategy
      </Link>
      <Link href="/watchlist" className="text-indigo-700 underline">
        Track your competitors
      </Link>
```

In `components/AppNav.tsx`, add an entry to `NAV_LINKS` between `LinkedIn` and `Billing`:
```ts
const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/diagnostic', label: 'Diagnostic' },
  { href: '/recap', label: 'Recap' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/linkedin', label: 'LinkedIn' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/billing', label: 'Billing' },
] as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx tests/unit/app/page-content.test.tsx components/AppNav.tsx tests/unit/components/AppNav.test.tsx
git commit -m "feat: link the competitor watchlist from the landing page and nav"
```

---

### Task 13: Playwright E2E smoke test

**Files:**
- Test: `tests/e2e/watchlist-smoke.spec.ts`

**Interfaces:**
- Consumes: `/watchlist` (Task 11), `GET`/`POST /api/watchlist` (Task 8), `DELETE /api/watchlist/[id]` (Task 9) — all mocked at the browser network layer via `page.route`, so no real Supabase/YouTube/Apify calls occur
- Produces: nothing consumed by later tasks — this is the terminal verification of the feature slice

- [ ] **Step 1: Write the E2E test**
```ts
// tests/e2e/watchlist-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a signed-out visitor on /watchlist sees a sign-in prompt, not a silent redirect', async ({ page }) => {
  await page.route('**/api/watchlist', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'You must be signed in.' }) })
  );

  await page.goto('/watchlist');

  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
});

test('a subscribed visitor adds a competitor, sees its snapshot, expands top posts, and removes it', async ({ page }) => {
  let added = false;

  await page.route('**/api/watchlist', async (route) => {
    if (route.request().method() === 'POST') {
      added = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: { id: 'e2e-entry-1' } }) });
      return;
    }
    const entries = added
      ? [
          {
            id: 'e2e-entry-1',
            platform: 'tiktok',
            handle: 'creator',
            url: 'https://www.tiktok.com/@creator',
            label: null,
            lastError: null,
            hasSnapshot: true,
            subscriberCount: 42000,
            totalViewCount: 900000,
            videoCount: 30,
            topPosts: [
              {
                captionOrTitle: 'Wait for it',
                url: 'https://www.tiktok.com/@creator/video/1',
                viewCount: 50000,
                publishedAt: '2026-09-09T00:00:00Z',
                viewsPerHour: 2083,
              },
            ],
            sevenDayDelta: { subscriberDelta: 1200, totalViewDelta: 50000, videoDelta: 2, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
            thirtyDayDelta: null,
          },
        ]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries, subscriptionRequired: false }) });
  });

  await page.route('**/api/watchlist/e2e-entry-1', async (route) => {
    await route.fulfill({ status: 204, contentType: 'application/json', body: '' });
  });

  await page.goto('/watchlist');
  await expect(page.getByText(/no competitors tracked yet/i)).toBeVisible();

  await page.getByLabel(/channel or profile link/i).fill('https://www.tiktok.com/@creator');
  await page.getByRole('button', { name: /add competitor/i }).click();

  await expect(page.getByText('@creator')).toBeVisible();
  await expect(page.getByText('42,000')).toBeVisible();

  await page.getByText(/view top posts/i).click();
  await expect(page.getByRole('link', { name: 'Wait for it' })).toBeVisible();

  await page.getByRole('button', { name: /remove/i }).click();
  await expect(page.getByText(/no competitors tracked yet/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && npm run test:e2e -- watchlist-smoke`
Expected: PASS — 2 tests passed.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/watchlist-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the competitor watchlist flow"
```

---

## Self-Review Notes

**Spec coverage:** Data model (§1) → Task 1. Fetching extensions (§2) → Tasks 2, 3. Aggregation (§3) → Task 4. Handler & refresh orchestration (§4) → Tasks 5, 6, 7. Rate limiting (§5) → Task 6. Routes & pages (§6) → Tasks 8, 9, 11, 12. Error handling (§7) → covered inline in Tasks 5–7 (401/402/400/409 on add, per-entry `lastError` without failing the request on list, 404 on remove) and Task 11 (rendered inline, never a full-page block). Testing plan (§8) → every listed case has a corresponding test in Tasks 1–13, including the specific "subscription-required serves cached data" and "budget-exhausted serves stale data" cases the spec called out as the feature's most important error-handling property.

**Placeholder scan:** No task contains TBD/TODO/"similar to Task N" — every step has complete, runnable code, including the full page component and its handler wiring (no shortcuts taken despite their size).

**Type consistency verified across tasks:** `ChannelStats` (2) → consumed by `fetchChannelSnapshotInput` in Task 6. `ProfilePost.followerCount` (3) → consumed in Task 6's scraper branch. `WatchlistEntry`/`WatchlistSnapshot`/`WatchlistEntryView`/`RankedPost`/`SnapshotDeltas`/`DuplicateWatchlistEntryError`/`WATCHLIST_ENTRY_LIMIT` (4) → consumed identically by Tasks 5–9 (handler + both routes) and Tasks 10–11 (page-state + page) — the exact same field names (`subscriberCount`, `totalViewCount`, `videoCount`, `hasSnapshot`, `sevenDayDelta`, `thirtyDayDelta`) flow from `buildSnapshotSummary`/`computeDeltas` through `toEntryView` through the route's JSON body through `WatchlistPageState.entries` through the JSX in Task 11, with no renaming at any hop. `AddWatchlistEntryDeps`/`ListWatchlistDeps`/`RemoveWatchlistEntryDeps` (5, 6, 7) are each satisfied by the single `buildDeps()` object Task 8 constructs (a structural superset), and by the narrower literal Task 9 constructs for delete alone.

**Scope check:** This plan implements the Competitor Watchlist end to end (data model through UI through E2E) as its own independently working feature slice, matching the size and shape of the prior Strategy Breakdown, Recap Card, and OAuth plans (12–13 tasks each). No further decomposition needed.

---

## Verification (once all 13 tasks are complete)

1. `npx tsc --noEmit` — clean typecheck across the whole repo (this is where a mistyped Database column or a deps-interface mismatch would surface).
2. `npx vitest run` — full suite green, including every new and modified test file above.
3. `npm run build` — production build succeeds.
4. `npm run test:e2e -- watchlist-smoke` — the new E2E test passes; also re-run the full `npm run test:e2e` suite to confirm nothing else regressed (e.g. the `AppNav`/landing-page changes don't break `home-smoke.spec.ts` or others).
5. Manually skim `supabase/migrations/20260910000001_create_watchlist_tables.sql` against §1 of the spec to confirm nothing was silently dropped.
