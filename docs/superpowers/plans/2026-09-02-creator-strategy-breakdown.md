# Creator Strategy Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in, subscribed creator paste a YouTube/TikTok/Instagram channel link and get back a saved, plain-English breakdown of that channel's posting cadence, format mix, and why its approach is working.

**Architecture:** A new `lib/strategy/` module (pure aggregation + a DI-deps handler) reuses existing infrastructure — `getChannelUploads`, `fetchProfilePosts`, `normalizeHandle`, `checkAndRecordRateLimit`, `computeEngagementRate` — rather than extending Diagnostic's single-post scoring engine. A new Claude client (`lib/integrations/claude-strategy.ts`) turns the aggregated stats into a narrative. Two new routes and two new pages follow the same shape as every other feature (paid-gated bootstrap GET + POST to generate, GET-by-id to view).

**Tech Stack:** Next.js (App Router, TypeScript), Supabase (Postgres, Auth), Vitest + Testing Library, Playwright — same stack as the rest of the app, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-creator-strategy-breakdown-design.md`

## Global Constraints

- Paid tier only (gated behind the $10/mo subscription) — never free like Diagnostic.
- Every generated breakdown is saved with its own id and report page — never regenerated fresh with no persistence.
- All three platforms (YouTube, TikTok, Instagram) ship together — not YouTube-only.
- `lib/ideas/` is not touched — no wiring into Weekly Content Ideas in this plan.
- No public share page — owner-only RLS, no `/strategy/[id]` equivalent reachable by anyone but the owner.
- Rate limiting matches Recap/Ideas exactly: 5/day per profile, 10/day per IP, 1-day window.
- Format mix uses flat duration buckets (`<=60s` / `60-240s` / `>240s`) — never `format-fit.ts`'s "ideal range" buckets.
- No route tests — routes stay thin wiring, verified via handler unit tests + Playwright E2E, per this repo's convention.

---

## File Structure

```
supabase/migrations/
  20260902000001_create_strategy_breakdowns.sql   # new table

lib/
  supabase/types.ts                    # + strategy_breakdowns Table entry (modify)
  integrations/
    scraper.ts                         # + ProfilePost.durationSeconds (modify)
    claude-strategy.ts                 # new Claude client
  recap/
    handles.ts                         # + detectHandlePlatform (modify)
  strategy/
    types.ts                           # ChannelPost, CadenceSummary, FormatMixSummary
    aggregate.ts                       # computeCadence, computeFormatMix, computeAverageEngagementRate
    handler.ts                         # handleStrategyBreakdownRequest
    page-state.ts                      # StrategyPageState/Event, reducer

app/
  page.tsx                             # + Strategy link (modify)
  api/
    strategy/
      route.ts                        # GET bootstrap, POST generate
      [id]/route.ts                    # GET by id
  strategy/
    page.tsx                           # input page
    [id]/page.tsx                       # report page

components/
  AppNav.tsx                           # + Strategy nav link (modify)

tests/
  fakes/
    claude-strategy.fake.ts            # createFakeStrategyClient
  unit/
    supabase/migrations.test.ts        # + strategy_breakdowns case (modify)
    lib/
      integrations/
        scraper.test.ts                # + durationSeconds coverage (modify)
        claude-strategy.test.ts
      recap/
        handles.test.ts                # + detectHandlePlatform cases (modify)
      strategy/
        aggregate.test.ts
        handler.test.ts
        page-state.test.ts
    app/
      page-content.test.tsx            # + Strategy link case (modify)
      strategy/
        page.test.tsx
        id-page.test.tsx
    components/
      AppNav.test.tsx                  # + Strategy link case (modify)
  e2e/
    strategy-smoke.spec.ts
```

---

### Task 1: `strategy_breakdowns` migration + Database types

**Files:**
- Create: `supabase/migrations/20260902000001_create_strategy_breakdowns.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: `public.profiles`, the existing `public.diagnostic_platform` enum
- Produces: `public.strategy_breakdowns` table; `Database['public']['Tables']['strategy_breakdowns']` — relied on by Task 6 (handler save), Task 7 (route insert), Task 8 (route select)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`, inside the existing `describe('supabase migrations', ...)` block:
```ts
  it('includes a strategy_breakdowns table migration owned by profile', () => {
    const sql = readMigrationContaining('create_strategy_breakdowns');
    expect(sql).toContain('create table public.strategy_breakdowns');
    expect(sql).toContain('platform public.diagnostic_platform not null');
    expect(sql).toContain('references public.profiles(id)');
    expect(sql).toContain('top_posts jsonb not null');
    expect(sql).toContain('"Strategy breakdowns are viewable by owner"');
    expect(sql).toContain('"Strategy breakdowns are insertable by owner"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_strategy_breakdowns\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260902000001_create_strategy_breakdowns.sql
create table public.strategy_breakdowns (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  channel_handle text not null,
  channel_url text not null,
  post_count integer not null,
  cadence jsonb not null,
  format_mix jsonb not null,
  top_posts jsonb not null,
  headline text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

alter table public.strategy_breakdowns enable row level security;

create policy "Strategy breakdowns are viewable by owner"
  on public.strategy_breakdowns for select
  using ((select auth.uid()) = profile_id);

create policy "Strategy breakdowns are insertable by owner"
  on public.strategy_breakdowns for insert
  with check ((select auth.uid()) = profile_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Add the Database type**

In `lib/supabase/types.ts`, add a new entry to `Database['public']['Tables']` (alongside `subscriptions`, before the closing `};` of `Tables`):
```ts
      strategy_breakdowns: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          channel_handle: string;
          channel_url: string;
          post_count: number;
          cadence: unknown;
          format_mix: unknown;
          top_posts: unknown;
          headline: string;
          explanation: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          channel_handle: string;
          channel_url: string;
          post_count: number;
          cadence: unknown;
          format_mix: unknown;
          top_posts: unknown;
          headline: string;
          explanation: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['strategy_breakdowns']['Insert']>;
        Relationships: [];
      };
```
This isn't independently tested here — it's exercised by Task 7's route (`tsc --noEmit` in that task's verification is where a mistyped column would surface).

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260902000001_create_strategy_breakdowns.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat: add strategy_breakdowns table migration and Database types"
```

---

### Task 2: `ProfilePost` gains optional `durationSeconds`

**Files:**
- Modify: `lib/integrations/scraper.ts`
- Modify: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `ProfilePost.durationSeconds?: number` — relied on by Task 6's handler (TikTok/Instagram post mapping)

**Why optional, not required:** `ProfilePost` is shared by the Apify scraper (`scraper.ts`) *and* the OAuth-based fetchers (`tiktok-oauth.ts`, `instagram-oauth.ts`) used by Recap Card's "my own connected account" flow. Strategy Breakdown only ever calls the Apify path (it analyzes someone else's public channel, never a token the user doesn't have) — a required field would force fabricated defaults into `tiktok-oauth.ts`/`instagram-oauth.ts` and break several existing tests in `tests/unit/lib/recap/handler.test.ts`, `tiktok-oauth.test.ts`, and `instagram-oauth.test.ts` for no real benefit. Optional keeps this change confined to the one path that actually has the data.

- [ ] **Step 1: Write the failing test**

In `tests/unit/lib/integrations/scraper.test.ts`, inside `describe('fetchProfilePosts', ...)`, add a new test after the existing `'starts an async Apify run...'` test:
```ts
    it('includes durationSeconds when the Apify item has a videoDuration field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '222',
              text: 'Post two',
              createTimeISO: '2026-08-03T10:00:00Z',
              videoDuration: 45,
              playCount: 2000,
              diggCount: 90,
              commentCount: 8,
              webVideoUrl: 'https://www.tiktok.com/@creator/video/222',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts[0].durationSeconds).toBe(45);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL with "expected undefined to be 45" (`durationSeconds` doesn't exist on `ProfilePost` yet)

- [ ] **Step 3: Implement**

In `lib/integrations/scraper.ts`, add `durationSeconds?: number;` to the `ProfilePost` interface (after `commentCount: number;`, before `permalink: string;`):
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
  permalink: string;
}
```

Update `normalizeProfilePost` to populate it, same source fields `fetchPost` already uses for `SocialPostMetadata.durationSeconds`:
```ts
function normalizeProfilePost(platform: 'tiktok' | 'instagram', item: Record<string, unknown>): ProfilePost {
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
    permalink: String(item.webVideoUrl ?? item.url ?? item.permalink ?? ''),
  };
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: The new test PASSES, but the pre-existing `'starts an async Apify run, polls until it succeeds, and normalizes the dataset items'` test now FAILS — its `toEqual` assertion doesn't expect a `durationSeconds` key at all, and the mocked item in that test has no `videoDuration`/`duration` field, so the real object now includes `durationSeconds: undefined`.

- [ ] **Step 5: Fix the pre-existing test's expectation**

In the same file, find the `'starts an async Apify run...'` test's `expect(posts).toEqual([...])` block and add `durationSeconds: undefined` to the expected object:
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
          permalink: 'https://www.tiktok.com/@creator/video/111',
        },
      ]);
```

- [ ] **Step 6: Run the full file to verify everything passes**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS (all tests, including the two touched above)

- [ ] **Step 7: Commit**
```bash
git add lib/integrations/scraper.ts tests/unit/lib/integrations/scraper.test.ts
git commit -m "feat: add optional durationSeconds to ProfilePost (Apify path only)"
```

---

### Task 3: `detectHandlePlatform` in `lib/recap/handles.ts`

**Files:**
- Modify: `lib/recap/handles.ts`
- Modify: `tests/unit/lib/recap/handles.test.ts`

**Interfaces:**
- Consumes: the existing private `HANDLE_HOSTS` map and `hostMatches` function (both already defined in this file)
- Produces: `detectHandlePlatform(url: string): RecapPlatform | null` — relied on by Task 6's handler

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/lib/recap/handles.test.ts` (update the import line, then add a new `describe` block):
```ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeHandle, saveRecapHandles, detectHandlePlatform } from '@/lib/recap/handles';
```
```ts
describe('detectHandlePlatform', () => {
  it('detects the platform from a YouTube URL', () => {
    expect(detectHandlePlatform('https://www.youtube.com/@creator')).toBe('youtube');
  });

  it('detects the platform from a TikTok URL', () => {
    expect(detectHandlePlatform('https://www.tiktok.com/@creator')).toBe('tiktok');
  });

  it('detects the platform from an Instagram URL', () => {
    expect(detectHandlePlatform('https://www.instagram.com/creator/')).toBe('instagram');
  });

  it('returns null for an unrelated URL', () => {
    expect(detectHandlePlatform('https://example.com/creator')).toBeNull();
  });

  it('returns null for a lookalike host', () => {
    expect(detectHandlePlatform('https://tiktok.com.evil.com/@creator')).toBeNull();
  });

  it('returns null for a bare handle with no host to detect', () => {
    expect(detectHandlePlatform('creator')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/handles.test.ts`
Expected: FAIL with "detectHandlePlatform is not a function" / import error

- [ ] **Step 3: Implement**

In `lib/recap/handles.ts`, add this export directly after `normalizeHandle`'s closing brace:
```ts
export function detectHandlePlatform(url: string): RecapPlatform | null {
  try {
    const parsed = new URL(url);
    const platforms = Object.keys(HANDLE_HOSTS) as RecapPlatform[];
    return platforms.find((platform) => HANDLE_HOSTS[platform].some((host) => hostMatches(parsed.hostname, host))) ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/handles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/recap/handles.ts tests/unit/lib/recap/handles.test.ts
git commit -m "feat: add detectHandlePlatform for single-field channel-URL platform detection"
```

---

### Task 4: `lib/strategy/types.ts` + `lib/strategy/aggregate.ts`

**Files:**
- Create: `lib/strategy/types.ts`
- Create: `lib/strategy/aggregate.ts`
- Test: `tests/unit/lib/strategy/aggregate.test.ts`

**Interfaces:**
- Consumes: `computeEngagementRate` from `@/lib/diagnostic/types`
- Produces: `ChannelPost`, `CadenceSummary`, `FormatMixSummary`; `computeCadence(posts)`, `computeFormatMix(posts)`, `computeAverageEngagementRate(platform, posts)` — relied on by Task 6's handler and Task 5's Claude client input shape

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/strategy/aggregate.test.ts
import { describe, it, expect } from 'vitest';
import { computeCadence, computeFormatMix, computeAverageEngagementRate } from '@/lib/strategy/aggregate';
import type { ChannelPost } from '@/lib/strategy/types';

function makePost(overrides: Partial<ChannelPost> = {}): ChannelPost {
  return {
    captionOrTitle: 'A post',
    publishedAt: '2026-08-11T10:00:00Z',
    durationSeconds: 30,
    viewCount: 1000,
    likeCount: 50,
    commentCount: 5,
    ...overrides,
  };
}

describe('computeCadence', () => {
  it('returns all zeros and a null day for an empty post list', () => {
    expect(computeCadence([])).toEqual({ postCount: 0, spanDays: 0, postsPerWeek: 0, mostCommonDayOfWeek: null });
  });

  it('falls back to postCount for postsPerWeek when the span is under a day', () => {
    const result = computeCadence([makePost({ publishedAt: '2026-08-11T10:00:00Z' })]);
    expect(result.spanDays).toBe(0);
    expect(result.postsPerWeek).toBe(1);
  });

  it('computes postsPerWeek from the span between the oldest and newest post', () => {
    // 3 posts spanning exactly 14 days (2 weeks) -> 3 / 14 * 7 = 1.5/week
    const posts = [
      makePost({ publishedAt: '2026-08-15T00:00:00Z' }),
      makePost({ publishedAt: '2026-08-08T00:00:00Z' }),
      makePost({ publishedAt: '2026-08-01T00:00:00Z' }),
    ];
    const result = computeCadence(posts);
    expect(result.spanDays).toBe(14);
    expect(result.postsPerWeek).toBe(1.5);
  });

  it('finds the most common day of the week', () => {
    // 2026-08-11 is a Tuesday; 2026-08-04 and 2026-07-28 are also Tuesdays.
    // 2026-08-06 is a Thursday (single occurrence).
    const posts = [
      makePost({ publishedAt: '2026-08-11T10:00:00Z' }),
      makePost({ publishedAt: '2026-08-06T10:00:00Z' }),
      makePost({ publishedAt: '2026-08-04T10:00:00Z' }),
      makePost({ publishedAt: '2026-07-28T10:00:00Z' }),
    ];
    expect(computeCadence(posts).mostCommonDayOfWeek).toBe('Tuesday');
  });

  it('breaks a day-of-week tie in favor of the most recent post (fetcher order is most-recent-first)', () => {
    // 2026-08-12 is a Wednesday, 2026-08-11 is a Tuesday -- one post each, tied.
    const posts = [makePost({ publishedAt: '2026-08-12T10:00:00Z' }), makePost({ publishedAt: '2026-08-11T10:00:00Z' })];
    expect(computeCadence(posts).mostCommonDayOfWeek).toBe('Wednesday');
  });
});

describe('computeFormatMix', () => {
  it('returns all zeros for an empty post list', () => {
    expect(computeFormatMix([])).toEqual({ averageDurationSeconds: 0, shortPct: 0, mediumPct: 0, longPct: 0 });
  });

  it('buckets posts into short/medium/long and computes the average duration', () => {
    const posts = [15, 45, 90, 300, 600].map((durationSeconds) => makePost({ durationSeconds }));
    const result = computeFormatMix(posts);
    expect(result.averageDurationSeconds).toBe(210);
    expect(result.shortPct).toBe(40);
    expect(result.mediumPct).toBe(20);
    expect(result.longPct).toBe(40);
  });

  it('treats exactly 60s as short and exactly 240s as medium (inclusive boundaries)', () => {
    const posts = [makePost({ durationSeconds: 60 }), makePost({ durationSeconds: 240 })];
    const result = computeFormatMix(posts);
    expect(result.shortPct).toBe(50);
    expect(result.mediumPct).toBe(50);
    expect(result.longPct).toBe(0);
  });
});

describe('computeAverageEngagementRate', () => {
  it('returns 0 for an empty post list', () => {
    expect(computeAverageEngagementRate('youtube', [])).toBe(0);
  });

  it('averages the per-post engagement rate across all posts', () => {
    const posts = [
      makePost({ likeCount: 100, commentCount: 0, viewCount: 1000 }), // 0.1
      makePost({ likeCount: 0, commentCount: 0, viewCount: 1000 }), // 0
    ];
    expect(computeAverageEngagementRate('youtube', posts)).toBe(0.05);
  });

  it('applies the TikTok comment weighting via the shared computeEngagementRate formula', () => {
    const posts = [makePost({ likeCount: 0, commentCount: 100, viewCount: 1000 })];
    // TikTok weights comments 2x: (0 + 100*2) / 1000 = 0.2
    expect(computeAverageEngagementRate('tiktok', posts)).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/strategy/aggregate.test.ts`
Expected: FAIL with "Cannot find module '@/lib/strategy/aggregate'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/strategy/types.ts
export interface ChannelPost {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface CadenceSummary {
  postCount: number;
  spanDays: number;
  postsPerWeek: number;
  mostCommonDayOfWeek: string | null;
}

export interface FormatMixSummary {
  averageDurationSeconds: number;
  shortPct: number;
  mediumPct: number;
  longPct: number;
}
```
```ts
// lib/strategy/aggregate.ts
import { computeEngagementRate } from '@/lib/diagnostic/types';
import type { ChannelPost, CadenceSummary, FormatMixSummary } from './types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeCadence(posts: ChannelPost[]): CadenceSummary {
  if (posts.length === 0) {
    return { postCount: 0, spanDays: 0, postsPerWeek: 0, mostCommonDayOfWeek: null };
  }

  const timestamps = posts.map((p) => new Date(p.publishedAt).getTime()).filter((t) => !Number.isNaN(t));
  const spanMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const spanDays = spanMs / MS_PER_DAY;
  const postsPerWeek = spanDays >= 1 ? (posts.length / spanDays) * 7 : posts.length;

  const dayCounts = new Map<number, number>();
  for (const post of posts) {
    const day = new Date(post.publishedAt).getUTCDay();
    if (Number.isNaN(day)) continue;
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  // posts are most-recent-first from both getChannelUploads and
  // fetchProfilePosts; iterating in that order and only replacing on a
  // strictly greater count means a tie is won by whichever day was
  // encountered first -- the more recently-established pattern.
  let mostCommonDay: number | null = null;
  let mostCommonCount = 0;
  for (const post of posts) {
    const day = new Date(post.publishedAt).getUTCDay();
    if (Number.isNaN(day)) continue;
    const count = dayCounts.get(day)!;
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonDay = day;
    }
  }

  return {
    postCount: posts.length,
    spanDays: Math.round(spanDays * 10) / 10,
    postsPerWeek: Math.round(postsPerWeek * 10) / 10,
    mostCommonDayOfWeek: mostCommonDay !== null ? DAY_NAMES[mostCommonDay] : null,
  };
}

export function computeFormatMix(posts: ChannelPost[]): FormatMixSummary {
  if (posts.length === 0) {
    return { averageDurationSeconds: 0, shortPct: 0, mediumPct: 0, longPct: 0 };
  }

  const durations = posts.map((p) => p.durationSeconds);
  const averageDurationSeconds = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);

  let shortCount = 0;
  let mediumCount = 0;
  let longCount = 0;
  for (const duration of durations) {
    if (duration <= 60) shortCount++;
    else if (duration <= 240) mediumCount++;
    else longCount++;
  }

  return {
    averageDurationSeconds,
    shortPct: Math.round((shortCount / posts.length) * 100),
    mediumPct: Math.round((mediumCount / posts.length) * 100),
    longPct: Math.round((longCount / posts.length) * 100),
  };
}

export function computeAverageEngagementRate(
  platform: 'youtube' | 'tiktok' | 'instagram',
  posts: ChannelPost[]
): number {
  if (posts.length === 0) return 0;
  const rates = posts.map((p) => computeEngagementRate(platform, p.likeCount, p.commentCount, p.viewCount));
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/strategy/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/strategy/types.ts lib/strategy/aggregate.ts tests/unit/lib/strategy/aggregate.test.ts
git commit -m "feat: add channel post types and cadence/format-mix/engagement-rate aggregation"
```

---

### Task 5: `lib/integrations/claude-strategy.ts`

**Files:**
- Create: `lib/integrations/claude-strategy.ts`
- Create: `tests/fakes/claude-strategy.fake.ts`
- Test: `tests/unit/lib/integrations/claude-strategy.test.ts`

**Interfaces:**
- Consumes: `CadenceSummary`, `FormatMixSummary` from `@/lib/strategy/types`
- Produces: `StrategyBreakdownInput`, `GeneratedStrategyBreakdown`, `StrategyBreakdownClient`, `STRATEGY_BREAKDOWN_SYSTEM_PROMPT`, `createClaudeStrategyClient(apiKey, model?)` — relied on by Task 6's handler; `createFakeStrategyClient` relied on by Task 6's test

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/integrations/claude-strategy.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeStrategyClient, STRATEGY_BREAKDOWN_SYSTEM_PROMPT } from '@/lib/integrations/claude-strategy';

describe('STRATEGY_BREAKDOWN_SYSTEM_PROMPT', () => {
  it('requires explaining why, in plain English', () => {
    expect(STRATEGY_BREAKDOWN_SYSTEM_PROMPT).toContain('WHY');
    expect(STRATEGY_BREAKDOWN_SYSTEM_PROMPT.toLowerCase()).toContain('plain english');
  });
});

const BASE_INPUT = {
  platform: 'tiktok' as const,
  channelHandle: 'creator',
  cadence: { postCount: 10, spanDays: 30, postsPerWeek: 2.3, mostCommonDayOfWeek: 'Tuesday' },
  formatMix: { averageDurationSeconds: 40, shortPct: 80, mediumPct: 20, longPct: 0 },
  averageEngagementRate: 0.08,
  topPosts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
};

describe('createClaudeStrategyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the strategy system prompt and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: JSON.stringify({ headline: 'Short, frequent posts are winning', explanation: 'This channel posts often because...' }) }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeStrategyClient('test-api-key');
    const result = await client.generateStrategyBreakdown(BASE_INPUT);

    expect(result.headline).toBe('Short, frequent posts are winning');
    expect(result.explanation).toContain('posts often');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe(STRATEGY_BREAKDOWN_SYSTEM_PROMPT);
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createClaudeStrategyClient('test-api-key');
    await expect(client.generateStrategyBreakdown(BASE_INPUT)).rejects.toThrow('Claude API request failed');
  });

  it('strips markdown code fences before parsing the JSON response', async () => {
    const fenced = '```json\n' + JSON.stringify({ headline: 'Fenced headline', explanation: 'Fenced explanation' }) + '\n```';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: fenced }] }) }));

    const client = createClaudeStrategyClient('test-api-key');
    const result = await client.generateStrategyBreakdown(BASE_INPUT);

    expect(result.headline).toBe('Fenced headline');
    expect(result.explanation).toBe('Fenced explanation');
  });

  it('throws a descriptive error when the response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: 'Sorry, cannot help.' }] }) })
    );
    const client = createClaudeStrategyClient('test-api-key');
    await expect(client.generateStrategyBreakdown(BASE_INPUT)).rejects.toThrow(
      'Claude API returned a response that could not be parsed as JSON.'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/claude-strategy.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/claude-strategy'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/integrations/claude-strategy.ts
import type { CadenceSummary, FormatMixSummary } from '@/lib/strategy/types';

export interface StrategyBreakdownInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  channelHandle: string;
  cadence: CadenceSummary;
  formatMix: FormatMixSummary;
  averageEngagementRate: number;
  topPosts: Array<{ captionOrTitle: string; viewCount: number }>;
}

export interface GeneratedStrategyBreakdown {
  headline: string;
  explanation: string;
}

export interface StrategyBreakdownClient {
  generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown>;
}

export const STRATEGY_BREAKDOWN_SYSTEM_PROMPT = `You are the channel-strategy-breakdown engine for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
Write in plain English for a 16-24 year old creator who does not know terms like "posting cadence" or "format mix".
For the channel's approach, you MUST explain WHY it is working (or not) in cause-and-effect terms the creator can act on -- never just restate the stats back at them.
Point at the specific posts you're given by title/caption when they support your point, not just abstract numbers.
Keep the tone encouraging but honest.

Ground your explanations in how each platform's algorithm actually behaves, without naming a data source by name:
- TikTok: finishing a video start-to-finish is one of the strongest interest signals TikTok's algorithm uses; the first 2 seconds decide most of a video's retention.
- Instagram: watch time, likes, and shares are Instagram's primary ranking signals for Reels; most viewers decide whether to keep watching within the first 3 seconds.
- YouTube: videos that lose most viewers before the 40% mark tend to get deprioritized; the platform starts rewarding videos with better suggested placement after the 8-minute mark for long-form content.

Respond with a short headline (max 12 words) and a 4-6 sentence explanation.`;

export function createClaudeStrategyClient(apiKey: string, model = 'claude-sonnet-5'): StrategyBreakdownClient {
  return {
    async generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown> {
      const topPostsSummary = input.topPosts.map((p) => `"${p.captionOrTitle}" (${p.viewCount} views)`).join(', ');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: STRATEGY_BREAKDOWN_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Platform: ${input.platform}\nChannel: ${input.channelHandle}\nPosts analyzed: ${input.cadence.postCount}\nPosting cadence: ~${input.cadence.postsPerWeek}/week, span ${input.cadence.spanDays} days, most common day ${input.cadence.mostCommonDayOfWeek ?? 'n/a'}\nFormat mix: ${input.formatMix.shortPct}% short (<=60s), ${input.formatMix.mediumPct}% medium (60-240s), ${input.formatMix.longPct}% long (>240s), average duration ${input.formatMix.averageDurationSeconds}s\nAverage engagement rate: ${(input.averageEngagementRate * 100).toFixed(2)}%\nTop posts: ${topPostsSummary}\n\nRespond as JSON: {"headline": string, "explanation": string}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      let parsed: { headline?: string; explanation?: string };
      try {
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('Claude API returned a response that could not be parsed as JSON.');
      }
      return {
        headline: parsed.headline ?? 'Your strategy breakdown',
        explanation: parsed.explanation ?? '',
      };
    },
  };
}
```
```ts
// tests/fakes/claude-strategy.fake.ts
import type { StrategyBreakdownClient, GeneratedStrategyBreakdown, StrategyBreakdownInput } from '@/lib/integrations/claude-strategy';

export function createFakeStrategyClient(overrides: Partial<GeneratedStrategyBreakdown> = {}): StrategyBreakdownClient {
  return {
    async generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown> {
      return {
        headline: `How this ${input.platform} channel is winning`,
        explanation: `Posting about ${input.cadence.postsPerWeek} times a week with a ${input.formatMix.shortPct}% short-form mix is working well for this channel.`,
        ...overrides,
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/claude-strategy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/integrations/claude-strategy.ts tests/fakes/claude-strategy.fake.ts tests/unit/lib/integrations/claude-strategy.test.ts
git commit -m "feat: add Claude strategy-breakdown narrative generation client"
```

---

### Task 6: `lib/strategy/handler.ts`

**Files:**
- Create: `lib/strategy/handler.ts`
- Test: `tests/unit/lib/strategy/handler.test.ts`

**Interfaces:**
- Consumes: `checkAndRecordRateLimit`/`releaseRateLimitEventIfNeeded`/`hashIp`/`RateLimitStore` (`@/lib/rate-limit`), `YouTubeClient` (`@/lib/integrations/youtube`), `ScraperClient` (`@/lib/integrations/scraper`), `StrategyBreakdownClient` (Task 5), `detectHandlePlatform`/`normalizeHandle` (Task 3), `computeCadence`/`computeFormatMix`/`computeAverageEngagementRate` (Task 4), `ChannelPost` (Task 4), fakes from Tasks 2/3/4/5
- Produces: `StrategyHandlerDeps`, `StrategyRequestContext`, `StrategyHandlerResult`, `handleStrategyBreakdownRequest(deps, context)`, `STRATEGY_GENERATION_PROFILE_LIMIT`, `STRATEGY_GENERATION_IP_LIMIT` — relied on by Task 7's route

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/strategy/handler.test.ts
import { describe, it, expect } from 'vitest';
import { handleStrategyBreakdownRequest, STRATEGY_GENERATION_PROFILE_LIMIT } from '@/lib/strategy/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeStrategyClient } from '../../../fakes/claude-strategy.fake';
import type { VideoMetadata } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';

function makeDeps(overrides: Partial<Parameters<typeof handleStrategyBreakdownRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    claudeStrategyClient: createFakeStrategyClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    saveStrategyBreakdown: async () => ({ id: 'strategy-1' }),
    ...overrides,
  };
}

describe('handleStrategyBreakdownRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleStrategyBreakdownRequest(makeDeps(), {
      profileId: null,
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('rejects an unsupported URL', async () => {
    const result = await handleStrategyBreakdownRequest(makeDeps(), {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://example.com/creator',
    });
    expect(result.status).toBe(400);
  });

  it('generates and saves a breakdown for a YouTube channel', async () => {
    const uploads: VideoMetadata[] = [
      {
        id: 'v1',
        title: 'Video 1',
        description: '',
        publishedAt: '2026-08-11T10:00:00Z',
        durationSeconds: 500,
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        tags: [],
      },
    ];
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, uploads) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(200);
    expect(result.body.id).toBe('strategy-1');
  });

  it('generates and saves a breakdown for a TikTok channel', async () => {
    const posts: ProfilePost[] = [
      {
        platform: 'tiktok',
        id: 't1',
        caption: 'Post',
        publishedAt: '2026-08-11T10:00:00Z',
        durationSeconds: 30,
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        permalink: 'https://tiktok.com/@creator/video/t1',
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, posts) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.tiktok.com/@creator',
    });
    expect(result.status).toBe(200);
  });

  it('defaults a TikTok/Instagram post missing durationSeconds to 0 rather than failing', async () => {
    const posts: ProfilePost[] = [
      {
        platform: 'instagram',
        id: 'ig1',
        caption: 'Post',
        publishedAt: '2026-08-11T10:00:00Z',
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        permalink: 'https://instagram.com/p/ig1',
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, posts) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.instagram.com/creator/',
    });
    expect(result.status).toBe(200);
  });

  it('returns a distinct 422 without releasing the rate-limit slot when the channel has no public posts', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, []) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(422);
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, []) });
    let result;
    for (let i = 0; i < STRATEGY_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleStrategyBreakdownRequest(deps, {
        profileId: 'p1',
        ip: '203.0.113.1',
        url: 'https://www.youtube.com/@creator',
      });
      expect(result.status).toBe(422); // zero posts each time, but still consumes an attempt
    }
    result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/strategy/handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/strategy/handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/strategy/handler.ts
import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { StrategyBreakdownClient } from '@/lib/integrations/claude-strategy';
import { detectHandlePlatform, normalizeHandle } from '@/lib/recap/handles';
import { computeCadence, computeFormatMix, computeAverageEngagementRate } from './aggregate';
import type { ChannelPost, CadenceSummary, FormatMixSummary } from './types';

export const STRATEGY_GENERATION_PROFILE_LIMIT = 5;
export const STRATEGY_GENERATION_IP_LIMIT = 10;

export interface StrategyHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  claudeStrategyClient: StrategyBreakdownClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  saveStrategyBreakdown: (params: {
    profileId: string;
    platform: 'youtube' | 'tiktok' | 'instagram';
    channelHandle: string;
    channelUrl: string;
    postCount: number;
    cadence: CadenceSummary;
    formatMix: FormatMixSummary;
    topPosts: Array<{ captionOrTitle: string; viewCount: number }>;
    headline: string;
    explanation: string;
  }) => Promise<{ id: string }>;
}

export interface StrategyRequestContext {
  profileId: string | null;
  ip: string;
  url: string;
}

export interface StrategyHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleStrategyBreakdownRequest(
  deps: StrategyHandlerDeps,
  context: StrategyRequestContext
): Promise<StrategyHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a strategy breakdown.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Creator Strategy Breakdown requires an active subscription.', upgradeUrl: '/billing' },
    };
  }

  const platform = detectHandlePlatform(context.url);
  const handle = platform ? normalizeHandle(platform, context.url) : null;
  if (!platform || !handle) {
    return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram channel URL.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'strategy_breakdown_generation',
    profileLimit: STRATEGY_GENERATION_PROFILE_LIMIT,
    ipLimit: STRATEGY_GENERATION_IP_LIMIT,
    windowDays: 1,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many strategy breakdowns have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for strategy breakdowns. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    let channelPosts: ChannelPost[];
    if (platform === 'youtube') {
      const uploads = await deps.youtubeClient.getChannelUploads(handle);
      channelPosts = uploads.map((v) => ({
        captionOrTitle: v.title,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
      }));
    } else {
      const posts = await deps.scraperClient.fetchProfilePosts(platform, handle);
      channelPosts = posts.map((p) => ({
        captionOrTitle: p.caption,
        publishedAt: p.publishedAt,
        durationSeconds: p.durationSeconds ?? 0,
        viewCount: p.viewCount,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
      }));
    }

    if (channelPosts.length === 0) {
      // A real, costly fetch ran and genuinely found no public posts to
      // analyze -- not our own failure, so the rate-limit event is NOT
      // released; it's a legitimate use of today's attempt. Mirrors
      // lib/ideas/handler.ts's identical "zero ideas" rule.
      return { status: 422, body: { error: "That channel doesn't have any public posts we could analyze." } };
    }

    const cadence = computeCadence(channelPosts);
    const formatMix = computeFormatMix(channelPosts);
    const averageEngagementRate = computeAverageEngagementRate(platform, channelPosts);
    const topPosts = [...channelPosts]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 3)
      .map((p) => ({ captionOrTitle: p.captionOrTitle, viewCount: p.viewCount }));

    const generated = await deps.claudeStrategyClient.generateStrategyBreakdown({
      platform,
      channelHandle: handle,
      cadence,
      formatMix,
      averageEngagementRate,
      topPosts,
    });

    const saved = await deps.saveStrategyBreakdown({
      profileId: context.profileId,
      platform,
      channelHandle: handle,
      channelUrl: context.url,
      postCount: channelPosts.length,
      cadence,
      formatMix,
      topPosts,
      headline: generated.headline,
      explanation: generated.explanation,
    });

    return { status: 200, body: { id: saved.id } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/strategy/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/strategy/handler.ts tests/unit/lib/strategy/handler.test.ts
git commit -m "feat: add strategy breakdown request handler"
```

---

### Task 7: `POST /api/strategy` + `GET /api/strategy` bootstrap route

**Files:**
- Create: `app/api/strategy/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (`@/lib/supabase/server`), `createSupabaseRateLimitStore` (`@/lib/supabase/rate-limit-store`), `createYouTubeClient` (`@/lib/integrations/youtube`), `createApifyScraperClient` (`@/lib/integrations/scraper`), `createClaudeStrategyClient` (Task 5), `deriveClientIp` (`@/lib/ip`), `handleStrategyBreakdownRequest` (Task 6), `hasActiveSubscription` (`@/lib/billing/entitlements`)
- Produces: `GET`/`POST` handlers for `/api/strategy` — no dedicated unit test (thin wiring, per this repo's convention); exercised by Task 13's E2E test

No test file for this task — per this repo's convention, routes are thin wiring verified by the handler's own unit tests (Task 6) plus the E2E test (Task 13). Verification for this task is `npx tsc --noEmit` passing.

- [ ] **Step 1: Write the route**
```ts
// app/api/strategy/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeStrategyClient } from '@/lib/integrations/claude-strategy';
import { deriveClientIp } from '@/lib/ip';
import { handleStrategyBreakdownRequest } from '@/lib/strategy/handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json(
      { error: 'Creator Strategy Breakdown requires an active subscription.', upgradeUrl: '/billing' },
      { status: 402 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: 'A channel or profile URL is required.' }, { status: 400 });
    }

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

    const result = await handleStrategyBreakdownRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        claudeStrategyClient: createClaudeStrategyClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        saveStrategyBreakdown: async (params) => {
          const { data, error } = await serviceClient
            .from('strategy_breakdowns')
            .insert({
              profile_id: params.profileId,
              platform: params.platform,
              channel_handle: params.channelHandle,
              channel_url: params.channelUrl,
              post_count: params.postCount,
              cadence: params.cadence,
              format_mix: params.formatMix,
              top_posts: params.topPosts,
              headline: params.headline,
              explanation: params.explanation,
            })
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save strategy breakdown: ${error?.message}`);
          }
          return { id: data.id };
        },
      },
      { profileId: user?.id ?? null, ip, url }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Strategy breakdown generation failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong generating your strategy breakdown. Please try again.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**
```bash
git add app/api/strategy/route.ts
git commit -m "feat: add GET/POST /api/strategy routes"
```

---

### Task 8: `GET /api/strategy/[id]`

**Files:**
- Create: `app/api/strategy/[id]/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` (`@/lib/supabase/server`)
- Produces: `GET` handler for `/api/strategy/[id]` — exercised by Task 11's page and Task 13's E2E test

No test file for this task — thin wiring, mirrors `app/api/diagnostic/[id]/route.ts` exactly (RLS on `strategy_breakdowns` enforces ownership; the regular cookie-scoped client is enough, no manual check needed).

- [ ] **Step 1: Write the route**
```ts
// app/api/strategy/[id]/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('strategy_breakdowns').select('*').eq('id', id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Strategy breakdown not found.' }, { status: 404 });
  }

  return NextResponse.json({ breakdown: data });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**
```bash
git add "app/api/strategy/[id]/route.ts"
git commit -m "feat: add GET /api/strategy/[id] route"
```

---

### Task 9: `lib/strategy/page-state.ts`

**Files:**
- Create: `lib/strategy/page-state.ts`
- Test: `tests/unit/lib/strategy/page-state.test.ts`

**Interfaces:**
- Consumes: `isValidEmailFormat` from `@/lib/auth/sign-in-flow-state`
- Produces: `StrategyPageState`, `StrategyPageEvent`, `createInitialStrategyPageState()`, `strategyPageReducer(state, event)` — relied on by Task 10's page

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/strategy/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { strategyPageReducer, createInitialStrategyPageState } from '@/lib/strategy/page-state';

describe('createInitialStrategyPageState', () => {
  it('starts in loading', () => {
    expect(createInitialStrategyPageState()).toEqual({ status: 'loading' });
  });
});

describe('strategyPageReducer', () => {
  it('moves to idle with an empty URL when bootstrap succeeds', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED' });
    expect(state).toEqual({ status: 'idle', url: '' });
  });

  it('moves to needsSignIn when bootstrap is unauthorized', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('moves to requiresUpgrade when bootstrap says payment is required', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(state).toEqual({ status: 'requiresUpgrade' });
  });

  it('updates the URL while idle', () => {
    const state = strategyPageReducer({ status: 'idle', url: '' }, { type: 'URL_CHANGED', value: 'https://youtube.com/@x' });
    expect(state).toEqual({ status: 'idle', url: 'https://youtube.com/@x' });
  });

  it('moves to submitting on SUBMIT from idle', () => {
    const state = strategyPageReducer(
      { status: 'idle', url: 'https://youtube.com/@x' },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false });
  });

  it('flags stillWorking while submitting', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false },
      { type: 'SUBMIT_STILL_WORKING' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true });
  });

  it('moves to redirecting on submit success', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false },
      { type: 'SUBMIT_SUCCESS', id: 'strategy-1' }
    );
    expect(state).toEqual({ status: 'redirecting', id: 'strategy-1' });
  });

  it('moves to submitFailed with the error and preserves the URL', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true },
      { type: 'SUBMIT_FAILED', error: 'Something broke' }
    );
    expect(state).toEqual({ status: 'submitFailed', url: 'https://youtube.com/@x', error: 'Something broke' });
  });

  it('allows re-submitting from submitFailed', () => {
    const state = strategyPageReducer(
      { status: 'submitFailed', url: 'https://youtube.com/@x', error: 'oops' },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false });
  });

  it('walks the full sign-in sub-flow', () => {
    let state = strategyPageReducer({ status: 'needsSignIn', email: '', notice: null }, { type: 'EMAIL_CHANGED', email: 'a@b.com' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });

    state = strategyPageReducer(state, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'MAGIC_LINK_SENT' });
    expect(state).toEqual({ status: 'checkEmail', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'RESEND_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'nope' });
    expect(state).toEqual({ status: 'magicLinkError', email: 'a@b.com', error: 'nope' });

    state = strategyPageReducer(state, { type: 'RETRY_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });

  it('ignores an invalid email on SUBMIT_EMAIL', () => {
    const state = strategyPageReducer({ status: 'needsSignIn', email: 'not-an-email', notice: null }, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'not-an-email', notice: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/strategy/page-state.test.ts`
Expected: FAIL with "Cannot find module '@/lib/strategy/page-state'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/strategy/page-state.ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

export type StrategyPageState =
  | { status: 'loading' }
  | { status: 'idle'; url: string }
  | { status: 'submitting'; url: string; stillWorking: boolean }
  | { status: 'submitFailed'; url: string; error: string }
  | { status: 'redirecting'; id: string }
  | { status: 'requiresUpgrade' }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type StrategyPageEvent =
  | { type: 'BOOTSTRAPPED' }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }
  | { type: 'URL_CHANGED'; value: string }
  | { type: 'SUBMIT' }
  | { type: 'SUBMIT_STILL_WORKING' }
  | { type: 'SUBMIT_SUCCESS'; id: string }
  | { type: 'SUBMIT_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialStrategyPageState(): StrategyPageState {
  return { status: 'loading' };
}

export function strategyPageReducer(state: StrategyPageState, event: StrategyPageEvent): StrategyPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return { status: 'idle', url: '' };

    case 'BOOTSTRAP_FAILED':
      return { status: 'idle', url: '' };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };

    case 'URL_CHANGED':
      return state.status === 'idle' || state.status === 'submitFailed' ? { status: 'idle', url: event.value } : state;

    case 'SUBMIT':
      return state.status === 'idle' || state.status === 'submitFailed'
        ? { status: 'submitting', url: state.url, stillWorking: false }
        : state;

    case 'SUBMIT_STILL_WORKING':
      return state.status === 'submitting' ? { ...state, stillWorking: true } : state;

    case 'SUBMIT_SUCCESS':
      return state.status === 'submitting' ? { status: 'redirecting', id: event.id } : state;

    case 'SUBMIT_FAILED':
      return state.status === 'submitting' ? { status: 'submitFailed', url: state.url, error: event.error } : state;

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

Run: `npx vitest run tests/unit/lib/strategy/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/strategy/page-state.ts tests/unit/lib/strategy/page-state.test.ts
git commit -m "feat: add /strategy page state machine"
```

---

### Task 10: `/strategy` input page

**Files:**
- Create: `app/strategy/page.tsx`
- Test: `tests/unit/app/strategy/page.test.tsx`

**Interfaces:**
- Consumes: `strategyPageReducer`/`createInitialStrategyPageState` (Task 9), `AppNav`, `Spinner`, `SignInPrompt`, `UpgradePrompt` (all existing, unchanged), `GET`/`POST /api/strategy` (Task 7)
- Produces: `StrategyPage` default export — exercised by Task 13's E2E test

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/strategy/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import StrategyPage from '@/app/strategy/page';

describe('StrategyPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows a sign-in prompt when bootstrap returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ error: 'nope' }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('shows an upgrade prompt when bootstrap returns 402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 402, ok: false, json: async () => ({ error: 'nope' }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument());
  });

  it('shows the input form when bootstrap succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ ok: true }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());
  });

  it('submits the URL and redirects to the report page on success', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (!options) return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ id: 'strategy-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://youtube.com/@creator' } });
    fireEvent.click(screen.getByRole('button', { name: /break down this channel/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/strategy/strategy-1'));
  });

  it('shows an inline error when generation fails', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (!options) return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ status: 429, ok: false, json: async () => ({ error: "You've hit today's limit." }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://youtube.com/@creator' } });
    fireEvent.click(screen.getByRole('button', { name: /break down this channel/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("hit today's limit"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/strategy/page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/strategy/page'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/strategy/page.tsx
'use client';

import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { strategyPageReducer, createInitialStrategyPageState } from '@/lib/strategy/page-state';

export default function StrategyPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(strategyPageReducer, createInitialStrategyPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/strategy')
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        if (res.status === 402) {
          dispatch({ type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
          return;
        }
        dispatch({ type: 'BOOTSTRAPPED' });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'submitting') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'SUBMIT_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  const redirectId = state.status === 'redirecting' ? state.id : undefined;
  useEffect(() => {
    if (redirectId) {
      router.push(`/strategy/${redirectId}`);
    }
  }, [redirectId, router]);

  async function submitUrl(url: string) {
    try {
      const response = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'SUBMIT_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'SUBMIT_SUCCESS', id: data.id });
    } catch {
      dispatch({
        type: 'SUBMIT_FAILED',
        error: "Something went wrong on our end. Try again in a moment — your attempt hasn't been used up.",
      });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/strategy' }),
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'idle' && state.status !== 'submitFailed') return;
    const url = state.url;
    dispatch({ type: 'SUBMIT' });
    void submitUrl(url);
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
        <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to run a strategy breakdown."
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

  if (state.status === 'requiresUpgrade') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
          <UpgradePrompt
            title="Creator Strategy Breakdown is part of Creator Dashboard's paid plan"
            body="Paste any channel you admire and get a plain-English breakdown of their posting cadence, format mix, and why it's working, for $10/mo."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
        <p className="text-gray-600">
          Paste a link to a YouTube, TikTok, or Instagram channel you admire — even one that isn&apos;t yours.
        </p>

        {(state.status === 'idle' || state.status === 'submitting' || state.status === 'submitFailed') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label htmlFor="channel-url" className="text-sm font-medium text-gray-700">
              Channel or profile link
            </label>
            <input
              id="channel-url"
              name="channel-url"
              type="url"
              required
              value={state.url}
              onChange={(e) => dispatch({ type: 'URL_CHANGED', value: e.target.value })}
              disabled={state.status === 'submitting'}
              placeholder="https://www.youtube.com/@channel"
              className="rounded-lg border border-gray-300 px-4 py-2"
            />
            <button
              type="submit"
              disabled={state.status === 'submitting'}
              className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {state.status === 'submitting' ? (
                <Spinner label={state.stillWorking ? 'Still working — studying their recent posts…' : 'Analyzing…'} />
              ) : (
                'Break down this channel'
              )}
            </button>
            {state.status === 'submitFailed' && (
              <p role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            )}
          </form>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/strategy/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/strategy/page.tsx tests/unit/app/strategy/page.test.tsx
git commit -m "feat: build the /strategy input page"
```

---

### Task 11: `/strategy/[id]` report page

**Files:**
- Create: `app/strategy/[id]/page.tsx`
- Test: `tests/unit/app/strategy/id-page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/strategy/[id]` (Task 8) response shape `{ breakdown: {...} }` / `{ error }`; `GlossaryText` (`@/components/GlossaryChip`); `AppNav`
- Produces: `StrategyBreakdownPage` default export — exercised by Task 13's E2E test

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/strategy/id-page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'strategy-1' }),
}));

import StrategyBreakdownPage from '@/app/strategy/[id]/page';

const BREAKDOWN = {
  platform: 'tiktok',
  channel_handle: 'creator',
  post_count: 12,
  cadence: { postCount: 12, spanDays: 30, postsPerWeek: 2.8, mostCommonDayOfWeek: 'Tuesday' },
  format_mix: { averageDurationSeconds: 35, shortPct: 80, mediumPct: 20, longPct: 0 },
  top_posts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
  headline: 'Short, frequent posts are driving this channel',
  explanation: 'This channel posts short-form content often, which keeps the algorithm engaged.',
};

describe('StrategyBreakdownPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the headline, stats, and explanation once loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ breakdown: BREAKDOWN }) }));

    render(<StrategyBreakdownPage />);

    expect(screen.getByText(/loading your breakdown/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Short, frequent posts are driving this channel')).toBeInTheDocument());
    expect(screen.getByText(/2\.8/)).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows an error message when the breakdown is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Strategy breakdown not found.' }) }));
    render(<StrategyBreakdownPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Strategy breakdown not found.'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/strategy/id-page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/strategy/[id]/page'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/strategy/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { GlossaryText } from '@/components/GlossaryChip';

interface StrategyBreakdownData {
  platform: 'youtube' | 'tiktok' | 'instagram';
  channel_handle: string;
  post_count: number;
  cadence: { postCount: number; spanDays: number; postsPerWeek: number; mostCommonDayOfWeek: string | null };
  format_mix: { averageDurationSeconds: number; shortPct: number; mediumPct: number; longPct: number };
  top_posts: Array<{ captionOrTitle: string; viewCount: number }>;
  headline: string;
  explanation: string;
}

export default function StrategyBreakdownPage() {
  const params = useParams<{ id: string }>();
  const [breakdown, setBreakdown] = useState<StrategyBreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/strategy/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setBreakdown(data.breakdown);
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading your breakdown. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <p role="alert">{error}</p>
        </main>
      </>
    );
  }

  if (!breakdown) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <p>Loading your breakdown…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">{breakdown.headline}</h1>
        <p className="text-sm text-gray-500">
          {breakdown.platform} · @{breakdown.channel_handle} · {breakdown.post_count} posts analyzed
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Posts per week</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.cadence.postsPerWeek}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Most common day</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.cadence.mostCommonDayOfWeek ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Short-form (&le;60s)</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.format_mix.shortPct}%</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Long-form (&gt;240s)</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.format_mix.longPct}%</p>
          </div>
        </div>

        <div className="text-base leading-relaxed text-gray-800">
          <GlossaryText text={breakdown.explanation} />
        </div>

        {breakdown.top_posts.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Top posts referenced</h2>
            <ul className="flex flex-col gap-1">
              {breakdown.top_posts.map((post, index) => (
                <li key={index} className="text-sm text-gray-700">
                  {post.captionOrTitle} — {post.viewCount.toLocaleString()} views
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/strategy/id-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add "app/strategy/[id]/page.tsx" tests/unit/app/strategy/id-page.test.tsx
git commit -m "feat: build the /strategy/[id] report page"
```

---

### Task 12: Landing page + nav links

**Files:**
- Modify: `app/page.tsx`
- Modify: `tests/unit/app/page-content.test.tsx`
- Modify: `components/AppNav.tsx`
- Modify: `tests/unit/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed by other tasks — discoverability only

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/app/page-content.test.tsx`, inside the existing `describe('MarketingPage content (signed out)', ...)` block:
```ts
  it('links to the strategy breakdown tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /break down a channel you admire/i })).toHaveAttribute('href', '/strategy');
  });
```

Append to `tests/unit/components/AppNav.test.tsx`, after the existing `'includes a Billing link'` test:
```ts
  it('includes a Strategy link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Strategy' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Strategy' })).toHaveAttribute('href', '/strategy');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: Both new tests FAIL — no such link exists yet

- [ ] **Step 3: Implement**

In `app/page.tsx`, add a new link after the existing "Get weekly content ideas" link:
```tsx
      <Link href="/ideas" className="text-indigo-700 underline">
        Get weekly content ideas
      </Link>
      <Link href="/strategy" className="text-indigo-700 underline">
        Break down a channel you admire
      </Link>
```

In `components/AppNav.tsx`, add an entry to `NAV_LINKS` between Ideas and Billing:
```ts
const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/diagnostic', label: 'Diagnostic' },
  { href: '/recap', label: 'Recap' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/billing', label: 'Billing' },
] as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx tests/unit/app/page-content.test.tsx components/AppNav.tsx tests/unit/components/AppNav.test.tsx
git commit -m "feat: link Creator Strategy Breakdown from the landing page and nav"
```

---

### Task 13: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/strategy-smoke.spec.ts`

**Interfaces:**
- Consumes: `/strategy` (Task 10), `/strategy/[id]` (Task 11) — mocks `GET`/`POST /api/strategy` and `GET /api/strategy/[id]` at the browser network layer, so no real Supabase/YouTube/Apify/Claude calls occur
- Produces: nothing consumed by later tasks — terminal verification of the feature slice

- [ ] **Step 1: Write the E2E test**
```ts
// tests/e2e/strategy-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a signed-out visitor on /strategy sees a sign-in prompt, not a silent redirect', async ({ page }) => {
  await page.route('**/api/strategy', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'You must be signed in.' }) })
  );

  await page.goto('/strategy');

  await expect(page).toHaveURL(/\/strategy$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
});

test('a subscribed visitor pastes a channel URL and sees a rendered breakdown', async ({ page }) => {
  await page.route('**/api/strategy', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-strategy-1' }) });
  });

  await page.route('**/api/strategy/e2e-strategy-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        breakdown: {
          platform: 'tiktok',
          channel_handle: 'creator',
          post_count: 12,
          cadence: { postCount: 12, spanDays: 30, postsPerWeek: 2.8, mostCommonDayOfWeek: 'Tuesday' },
          format_mix: { averageDurationSeconds: 35, shortPct: 80, mediumPct: 20, longPct: 0 },
          top_posts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
          headline: 'Short, frequent posts are driving this channel',
          explanation: 'This channel posts short-form content often, which keeps the algorithm engaged.',
        },
      }),
    });
  });

  await page.goto('/strategy');
  await page.getByLabel(/channel or profile link/i).fill('https://www.tiktok.com/@creator');
  await page.getByRole('button', { name: /break down this channel/i }).click();

  await expect(page).toHaveURL(/\/strategy\/e2e-strategy-1$/);
  await expect(page.getByRole('heading', { name: 'Short, frequent posts are driving this channel' })).toBeVisible();
  await expect(page.getByText('Tuesday')).toBeVisible();
  await expect(page.getByText('80%')).toBeVisible();
});
```

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: All E2E tests PASS, including the 2 new ones.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/strategy-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the strategy breakdown flow"
```

---

## Self-Review Notes

**Spec coverage:** §1 data model → Task 1 (including the `top_posts` column, added during this review pass — see below). §2 URL resolution → Task 3. §3 fetching/aggregation → Tasks 2, 4. §4 Claude glue → Task 5. §5 access/rate-limiting → Task 6. §6 routes/pages → Tasks 7, 8, 10, 11 (plus Task 12 for discoverability, implied by "same shape as every other feature page"). §7 error handling → covered inline in Task 6. §8 testing plan → every task carries its own tests; Task 13 is the E2E closer.

**Deviations from the spec caught during planning (fixed here, not silently absorbed):**
1. **`ProfilePost.durationSeconds` is optional, not required as the spec's wording implied.** The spec called this "a small, targeted addition to existing code." Tracing actual usage showed `ProfilePost` is shared with the OAuth-based fetchers (`tiktok-oauth.ts`, `instagram-oauth.ts`) used by Recap Card, which Strategy Breakdown never calls — a required field would have forced fabricated defaults into two unrelated production files and broken several existing tests. Optional keeps the change confined to the one path (Apify) that actually has the data; `computeFormatMix` and the handler's TikTok/Instagram branch treat a missing value as `0`.
2. **The `strategy_breakdowns` table gained a `top_posts jsonb` column** not present in the spec's §1 schema. The spec's own §6 promised the report page would show "the top 3 referenced posts with view counts," but the schema never stored them — without persistence, that UI element would have had nothing to render on a revisit. Threaded through Task 1 (column), Task 6 (handler saves it), Task 7 (route inserts it), Task 11 (page renders it).

Neither changes the feature's approved shape or any of the five confirmed decisions — both are implementation-completeness fixes caught by tracing actual call sites and cross-checking the schema against what the UI was promised.

**Placeholder scan:** No task contains TBD/TODO or "similar to Task N." Tasks 7 and 8 (routes) intentionally have no dedicated test file, per this repo's established no-route-tests convention — this is called out explicitly in each, not silently omitted.

**Type consistency verified across tasks:** `ChannelPost`/`CadenceSummary`/`FormatMixSummary` (Task 4) → consumed identically by Task 5's `StrategyBreakdownInput`, Task 6's handler, and Task 11's page's local type mirror. `StrategyBreakdownClient`/`GeneratedStrategyBreakdown` (Task 5) → consumed by Task 6. `detectHandlePlatform`/`normalizeHandle` (Task 3, existing) → consumed by Task 6. `StrategyHandlerDeps`/`StrategyRequestContext`/`StrategyHandlerResult` (Task 6) → consumed by Task 7's route. `StrategyPageState`/`StrategyPageEvent` (Task 9) → consumed by Task 10's page. The `strategy_breakdowns` Database Row shape (Task 1) → matches the `insert(...)` call in Task 7 and the `StrategyBreakdownData` shape read in Task 11 field-for-field (`cadence`/`format_mix`/`top_posts` all `jsonb`, read back as their original object shapes).

---

## Verification (end-to-end, once all 13 tasks are complete)

1. `npm run typecheck && npm run lint` — clean.
2. `npm test` — full Vitest suite green, including every new/modified file above.
3. `npm run build` — production build succeeds.
4. `npm run test:e2e` — full Playwright suite passes, including the 2 new strategy tests.
5. Manually confirm `docs/superpowers/specs/2026-09-02-creator-strategy-breakdown-design.md`'s 5 confirmed decisions are all reflected: paid gate (Task 6/7), persistence (Task 1/6/7/8/11), all 3 platforms (Task 6), no Ideas wiring (nothing in this plan touches `lib/ideas/`), no public share page (RLS in Task 1 is owner-only, no public route added).
