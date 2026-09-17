# Reach / Audience-Fit Diagnostic Dimension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th diagnostic scoring dimension (Reach / Audience-Fit) that measures whether a post's views were proportionate to the account's follower count, fixing a real production bug where huge accounts with terrible reach (e.g. a 5.4M-follower Instagram account getting 34K views) scored as "moderate."

**Architecture:** New pure-function scoring module (`lib/diagnostic/reach.ts`) alongside the existing 4. Follower count is fetched per-platform (free for TikTok, one extra cheap Apify call for Instagram, one extra `channels.list` call for YouTube) and threaded through the existing report-generation pipeline. When follower count can't be obtained, Reach is omitted and the other 4 dimensions reweight back to their original split — never a hard failure.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (Postgres + migrations), Apify (TikTok/Instagram scraping), YouTube Data API v3, Anthropic Claude API, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-reach-audience-fit-design.md`

## Global Constraints

- Reach is a 5th dimension, never folded into Hook Strength.
- Formula: `reachRatio = viewCount / followerCount`, log-scaled. Weak/moderate boundary at `reachRatio = 0.1` → score 40. Moderate/strong boundary at `reachRatio = 2.0` → score 70.
- Wording must never claim calendar-based rarity ("best video in 5 years") — only relative-to-followers language.
- Weights when Reach is present: Hook Strength 0.23, Retention Risk 0.23, Reach 0.23, Timing 0.155, Format Fit 0.155 (sums to 1.0). Weights when Reach is absent: unchanged at Hook Strength 0.3, Retention Risk 0.3, Timing 0.2, Format Fit 0.2.
- Missing follower count (fetch failure, hidden count, zero/invalid value) → omit Reach entirely, reweight the rest, never fail the whole diagnostic. Log, don't throw.
- No UI changes — `app/diagnostic/[id]/page.tsx` only ever renders headline/overall score/prose; nothing here changes that contract.
- Out of scope entirely (do not implement): follower-band-segmented thresholds, historical/percentile comparison (V2), the "post too new to score" gap, and every other parked idea listed in the spec's Non-goals section.

---

### Task 1: Database migration for `reach_score`

**Files:**
- Create: `supabase/migrations/20260917000001_add_reach_score_to_diagnostics.sql`
- Test: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Produces: a nullable `reach_score integer` column on `public.diagnostics`, consumed by Task 7's `saveDiagnostic` insert.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/supabase/migrations.test.ts` (follow the existing `readMigrationContaining` pattern already in this file):

```ts
it('includes a migration adding reach_score to diagnostics', () => {
  const sql = readMigrationContaining('add_reach_score');
  expect(sql).toContain('alter table public.diagnostics');
  expect(sql).toContain('add column reach_score integer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"add_reach_score\""

- [ ] **Step 3: Write the migration**

```sql
alter table public.diagnostics
  add column reach_score integer;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917000001_add_reach_score_to_diagnostics.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat(diagnostic): add reach_score column to diagnostics"
```

---

### Task 2: Follower count fetching for TikTok and Instagram

**Files:**
- Modify: `lib/integrations/scraper.ts`
- Modify: `tests/fakes/scraper.fake.ts`
- Test: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses the existing `run-sync-get-dataset-items` Apify pattern already in this file.
- Produces: `SocialPostMetadata.followerCount?: number`, consumed by Task 6 (`report.ts`) via Task 7 (`handler.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/integrations/scraper.test.ts`, inside the `describe('createApifyScraperClient', ...)` block:

```ts
it('maps TikTok authorMeta.fans to followerCount with no extra request', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      {
        id: '12345',
        text: 'Day 1 of posting every day #creator',
        createTimeISO: '2026-08-01T10:00:00Z',
        videoDuration: 32,
        playCount: 20000,
        diggCount: 1500,
        commentCount: 80,
        authorMeta: { fans: 48300 },
      },
    ],
  });
  vi.stubGlobal('fetch', fetchMock);

  const client = createApifyScraperClient('test-token');
  const post = await client.fetchPost('https://www.tiktok.com/@user/video/12345');

  expect(post.followerCount).toBe(48300);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('fetches Instagram follower count via a second details call', async () => {
  const postScrapeResponse = {
    ok: true,
    status: 200,
    json: async () => [
      {
        id: 'abc123',
        shortCode: 'abc123',
        caption: 'A great reel',
        timestamp: '2026-08-01T10:00:00Z',
        videoViewCount: 34000,
        likesCount: 500,
        commentsCount: 12,
        ownerUsername: 'nba2k',
      },
    ],
  };
  const detailsResponse = {
    ok: true,
    status: 200,
    json: async () => [{ followersCount: 5400000 }],
  };
  const sequencedFetch = vi.fn()
    .mockResolvedValueOnce(postScrapeResponse)
    .mockResolvedValueOnce(detailsResponse);
  vi.stubGlobal('fetch', sequencedFetch);

  const client = createApifyScraperClient('test-token');
  const post = await client.fetchPost('https://www.instagram.com/reel/abc123/');

  expect(post.followerCount).toBe(5400000);
  expect(sequencedFetch).toHaveBeenCalledTimes(2);
  const secondCallBody = JSON.parse(sequencedFetch.mock.calls[1][1].body);
  expect(secondCallBody).toEqual({ resultsType: 'details', directUrls: ['https://www.instagram.com/nba2k/'] });
});

it('omits followerCount (not throwing) when the Instagram details call fails', async () => {
  const postScrapeResponse = {
    ok: true,
    status: 200,
    json: async () => [
      {
        id: 'abc123',
        caption: 'A great reel',
        timestamp: '2026-08-01T10:00:00Z',
        videoViewCount: 34000,
        likesCount: 500,
        commentsCount: 12,
        ownerUsername: 'nba2k',
      },
    ],
  };
  const failedDetailsResponse = { ok: false, status: 500 };
  const sequencedFetch = vi.fn()
    .mockResolvedValueOnce(postScrapeResponse)
    .mockResolvedValueOnce(failedDetailsResponse);
  vi.stubGlobal('fetch', sequencedFetch);

  const client = createApifyScraperClient('test-token');
  const post = await client.fetchPost('https://www.instagram.com/reel/abc123/');

  expect(post.followerCount).toBeUndefined();
});
```

Remove the `if (url.includes(...))` dead branch from the second test above before committing — it was left in as a note; the `mockResolvedValueOnce` chain is what actually drives the two sequential responses.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL — `followerCount` is `undefined`/property doesn't exist yet, and the Instagram test only sees one fetch call.

- [ ] **Step 3: Implement**

In `lib/integrations/scraper.ts`, add to `SocialPostMetadata`:

```ts
export interface SocialPostMetadata {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  saveCount?: number;
  followerCount?: number; // best-effort; absent if unavailable for this platform/account
}
```

Update `fetchPost` (inside `createApifyScraperClient`):

```ts
async fetchPost(url: string): Promise<SocialPostMetadata> {
  const platform = detectSocialPlatform(url);
  if (!platform) {
    throw new Error(`Unsupported social URL: ${url}`);
  }
  const actorId = APIFY_ACTORS[platform];
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`;
  const response = await fetch(runUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPostInput(platform, url)),
  });
  if (!response.ok) {
    throw new Error(`Apify scrape failed with status ${response.status}`);
  }
  const items = await response.json();
  const item = items[0];
  if (!item) {
    throw new Error(`Apify returned no data for ${url}`);
  }

  let followerCount: number | undefined = platform === 'tiktok' ? item.authorMeta?.fans : undefined;
  if (platform === 'instagram' && item.ownerUsername) {
    followerCount = await fetchInstagramFollowerCount(item.ownerUsername, apiToken);
  }

  return {
    platform,
    id: String(item.id ?? item.videoId ?? item.shortCode ?? url),
    caption: item.text ?? item.caption ?? '',
    publishedAt: item.createTimeISO ?? item.timestamp ?? new Date().toISOString(),
    durationSeconds: Number(item.videoDuration ?? item.duration ?? 0),
    viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
    likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
    commentCount: Number(item.commentCount ?? 0),
    shareCount: platform === 'tiktok' && item.shareCount !== undefined ? Number(item.shareCount) : undefined,
    saveCount: platform === 'tiktok' && item.collectCount !== undefined ? Number(item.collectCount) : undefined,
    followerCount,
  };
},
```

Add a new top-level helper (near `runApifyActorAndWait`), never throwing:

```ts
async function fetchInstagramFollowerCount(ownerUsername: string, apiToken: string): Promise<number | undefined> {
  try {
    const runUrl = `https://api.apify.com/v2/acts/${APIFY_ACTORS.instagram}/run-sync-get-dataset-items?token=${apiToken}`;
    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultsType: 'details', directUrls: [`https://www.instagram.com/${ownerUsername}/`] }),
    });
    if (!response.ok) return undefined;
    const items = await response.json();
    const followersCount = items[0]?.followersCount;
    return typeof followersCount === 'number' ? followersCount : undefined;
  } catch {
    // Never let a failed follower-count lookup fail the whole diagnostic — see spec §2 / Global Constraints.
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Update the fake**

In `tests/fakes/scraper.fake.ts`, add `followerCount` support to the overridable metadata (it already spreads `...overrides` onto a `SocialPostMetadata`-typed object, so no structural change is needed — just confirm the type import picks up the new optional field automatically). Run `npx tsc --noEmit` to confirm no type errors ripple into existing fake usages.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/scraper.ts tests/unit/lib/integrations/scraper.test.ts tests/fakes/scraper.fake.ts
git commit -m "feat(diagnostic): fetch follower count for TikTok and Instagram posts"
```

---

### Task 3: Subscriber count fetching for YouTube

**Files:**
- Modify: `lib/integrations/youtube.ts`
- Modify: `tests/fakes/youtube.fake.ts`
- Test: `tests/unit/lib/integrations/youtube.test.ts`

**Interfaces:**
- Produces: `VideoMetadata.channelId: string` and a new `YouTubeClient.getChannelSubscriberCount(channelId: string): Promise<number | null>`, consumed by Task 7 (`handler.ts`).
- Consumes: nothing new from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/integrations/youtube.test.ts` (find this file's existing `getVideoMetadata`/`getChannelStats` test blocks and follow their mocking style — they stub `fetch` and assert on the returned shape and the requested URL):

```ts
describe('getChannelSubscriberCount', () => {
  it('returns the subscriber count for a channel ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ statistics: { subscriberCount: '5400000' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createYouTubeClient('test-key');
    const count = await client.getChannelSubscriberCount('UCabc123');

    expect(count).toBe(5400000);
    const requestedUrl = fetchMock.mock.calls[0][0].toString();
    expect(requestedUrl).toContain('id=UCabc123');
    expect(requestedUrl).toContain('part=statistics');
  });

  it('returns null when the channel has hidden its subscriber count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ statistics: { hiddenSubscriberCount: true } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createYouTubeClient('test-key');
    const count = await client.getChannelSubscriberCount('UCabc123');

    expect(count).toBeNull();
  });

  it('throws ChannelNotFoundError when the channel ID does not resolve', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createYouTubeClient('test-key');
    await expect(client.getChannelSubscriberCount('UCnonexistent')).rejects.toThrow(ChannelNotFoundError);
  });
});
```

Add the `ChannelNotFoundError` import at the top of the test file if not already imported: `import { createYouTubeClient, ChannelNotFoundError } from '@/lib/integrations/youtube';`

Also add a `channelId` assertion to whichever existing test covers `getVideoMetadata`'s happy path — extend its mocked response's `snippet` with `channelId: 'UCabc123'` and assert `result.channelId).toBe('UCabc123')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: FAIL — `getChannelSubscriberCount` doesn't exist yet; `channelId` is `undefined` on `VideoMetadata`.

- [ ] **Step 3: Implement**

In `lib/integrations/youtube.ts`:

Add `channelId` to `VideoMetadata`:

```ts
export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
  channelId: string;
}
```

Update `mapVideoItem` to read `item.snippet.channelId`:

```ts
function mapVideoItem(item: {
  id: string;
  snippet: { title: string; description: string; publishedAt: string; tags?: string[]; channelId: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails: { duration: string };
}): VideoMetadata {
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    viewCount: Number(item.statistics.viewCount ?? 0),
    likeCount: Number(item.statistics.likeCount ?? 0),
    commentCount: Number(item.statistics.commentCount ?? 0),
    tags: item.snippet.tags ?? [],
    channelId: item.snippet.channelId,
  };
}
```

Add the new method to the `YouTubeClient` interface:

```ts
export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
  getChannelUploads(handle: string, maxResults?: number): Promise<VideoMetadata[]>;
  getChannelStats(handle: string): Promise<ChannelStats>;
  /**
   * Subscriber count by channel ID, not handle — Diagnostic only ever has a
   * channelId from a video lookup, unlike Watchlist's getChannelStats(handle)
   * which resolves from a stored handle. See design spec §2.
   */
  getChannelSubscriberCount(channelId: string): Promise<number | null>;
}
```

Implement it in `createYouTubeClient`'s returned object:

```ts
async getChannelSubscriberCount(channelId: string): Promise<number | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('id', channelId);
  url.searchParams.set('part', 'statistics');
  url.searchParams.set('key', apiKey);
  const data = await fetchYouTubeJson(url);
  const channel = data.items?.[0];
  if (!channel) {
    throw new ChannelNotFoundError(channelId);
  }
  const stats = channel.statistics ?? {};
  return stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0);
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: Update the fake**

In `tests/fakes/youtube.fake.ts`, add `channelId: 'fake-channel-id'` to the default `metadata` object, add a 4th parameter `subscriberCount: number | null = 1000` to `createFakeYouTubeClient`'s signature (after the existing `channelStats` parameter), and add `getChannelSubscriberCount: async () => subscriberCount` to the returned object. The full updated signature:

```ts
export function createFakeYouTubeClient(
  overrides: Partial<VideoMetadata> = {},
  channelUploads: VideoMetadata[] = [],
  channelStats: ChannelStats = { subscriberCount: 1000, totalViewCount: 50000, videoCount: 20 },
  subscriberCount: number | null = 1000
): YouTubeClient {
```

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/youtube.ts tests/unit/lib/integrations/youtube.test.ts tests/fakes/youtube.fake.ts
git commit -m "feat(diagnostic): fetch subscriber count by channel ID for YouTube"
```

---

### Task 4: Reach scoring module

**Files:**
- Create: `lib/diagnostic/reach.ts`
- Test: `tests/unit/lib/diagnostic/reach.test.ts`

**Interfaces:**
- Consumes: `ScoreResult`, `labelForScore` from `./types` (existing).
- Produces: `scoreReach(input: ReachInput): ScoreResult`, consumed by Task 6 (`report.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/diagnostic/reach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreReach } from '@/lib/diagnostic/reach';

describe('scoreReach', () => {
  it('scores exactly the weak/moderate boundary (10% reach) as 40', () => {
    const result = scoreReach({ viewCount: 100_000, followerCount: 1_000_000 });
    expect(result.score).toBe(40);
    expect(result.label).toBe('moderate');
  });

  it('scores exactly the moderate/strong boundary (200% reach) as 70', () => {
    const result = scoreReach({ viewCount: 2_000_000, followerCount: 1_000_000 });
    expect(result.score).toBe(70);
    expect(result.label).toBe('strong');
  });

  it('clamps very low reach to 0', () => {
    const result = scoreReach({ viewCount: 1, followerCount: 5_400_000 });
    expect(result.score).toBe(0);
    expect(result.label).toBe('weak');
  });

  it('clamps very high reach to 100', () => {
    const result = scoreReach({ viewCount: 34_800_000, followerCount: 64_700 });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('reproduces the real NBA 2K case: 34K views on 5.4M followers scores weak', () => {
    const result = scoreReach({ viewCount: 34_000, followerCount: 5_400_000 });
    expect(result.label).toBe('weak');
  });

  it('always returns at least one reason', () => {
    const result = scoreReach({ viewCount: 500_000, followerCount: 1_000_000 });
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/reach.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/reach'"

- [ ] **Step 3: Implement**

Create `lib/diagnostic/reach.ts`:

```ts
import { labelForScore, type ScoreResult } from './types';

export interface ReachInput {
  viewCount: number;
  followerCount: number; // caller (report.ts) only invokes this when a follower count was actually obtained
}

// Log-scaled: weak/moderate boundary at 10% of followers (score 40), moderate/strong
// boundary at 200% of followers (score 70). NOT sourced from published research — no
// such benchmark exists for reach-as-percent-of-followers. Calibrated interactively
// against the product owner's own judgment on real posts and hypothetical view counts
// for a 1M-follower account (2026-09-17 calibration session). See
// docs/superpowers/specs/2026-09-17-reach-audience-fit-design.md and
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const WEAK_MODERATE_BOUNDARY_RATIO = 0.1;
const MODERATE_STRONG_BOUNDARY_RATIO = 2.0;
const SLOPE = 30 / (Math.log10(MODERATE_STRONG_BOUNDARY_RATIO) - Math.log10(WEAK_MODERATE_BOUNDARY_RATIO));

export function scoreReach(input: ReachInput): ScoreResult {
  const views = Math.max(input.viewCount, 1);
  const reachRatio = views / input.followerCount;
  const rawScore = 40 + (Math.log10(reachRatio) - Math.log10(WEAK_MODERATE_BOUNDARY_RATIO)) * SLOPE;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const reasons: string[] =
    score >= 70
      ? ['Your views are several times your follower count, meaning this reached well beyond your existing audience.']
      : score >= 40
        ? ['Your views are roughly in line with your follower count — a typical result for content that mostly reached your existing audience.']
        : ['Your views are below what would be expected given your follower count, suggesting this post got limited distribution beyond your existing audience.'];

  return { score, label: labelForScore(score), reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/reach.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostic/reach.ts tests/unit/lib/diagnostic/reach.test.ts
git commit -m "feat(diagnostic): add Reach/Audience-Fit scoring module"
```

---

### Task 5: Rebalance `combineScores` weighting

**Files:**
- Modify: `lib/diagnostic/score.ts`
- Test: `tests/unit/lib/diagnostic/score.test.ts`

**Interfaces:**
- Consumes: `scoreReach`'s `ScoreResult | null` shape from Task 4 (imported by type only — `score.ts` doesn't call `scoreReach` itself, `report.ts` does in Task 6).
- Produces: `combineScores` accepting an optional `reach: ScoreResult | null` and branching its weights accordingly, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/diagnostic/score.test.ts` (this file already has a `makeScore` helper — reuse it):

```ts
it('uses the original 30/30/20/20 weights when reach is null', () => {
  const withoutReach = combineScores({
    hookStrength: makeScore(100),
    retentionRisk: makeScore(100),
    timing: makeScore(0),
    formatFit: makeScore(0),
    reach: null,
  });
  // 100*0.3 + 100*0.3 + 0*0.2 + 0*0.2 = 60
  expect(withoutReach.overallScore).toBe(60);
});

it('uses the 23/23/23/15.5/15.5 weights when reach is present', () => {
  const withReach = combineScores({
    hookStrength: makeScore(100),
    retentionRisk: makeScore(100),
    timing: makeScore(0),
    formatFit: makeScore(0),
    reach: makeScore(100),
  });
  // 100*0.23 + 100*0.23 + 100*0.23 = 69
  expect(withReach.overallScore).toBe(69);
});

it('preserves a null reach on the combined result', () => {
  const result = combineScores({
    hookStrength: makeScore(60),
    retentionRisk: makeScore(60),
    timing: makeScore(60),
    formatFit: makeScore(60),
    reach: null,
  });
  expect(result.reach).toBeNull();
});
```

Update this file's existing three tests to pass `reach: null` explicitly (the `CombinedScoreInput` type will require it once Task 5's implementation lands) — add `reach: null` to each existing `combineScores({...})` call in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/diagnostic/score.test.ts`
Expected: FAIL — type error (missing `reach` property) and/or wrong `overallScore` values.

- [ ] **Step 3: Implement**

Replace the contents of `lib/diagnostic/score.ts`:

```ts
import type { ScoreResult } from './types';

export interface CombinedScoreInput {
  hookStrength: ScoreResult;
  retentionRisk: ScoreResult;
  timing: ScoreResult;
  formatFit: ScoreResult;
  reach: ScoreResult | null;
}

export interface CombinedScore extends CombinedScoreInput {
  overallScore: number;
}

const WEIGHTS_WITH_REACH = { hookStrength: 0.23, retentionRisk: 0.23, reach: 0.23, timing: 0.155, formatFit: 0.155 };
const WEIGHTS_WITHOUT_REACH = { hookStrength: 0.3, retentionRisk: 0.3, timing: 0.2, formatFit: 0.2 };

export function combineScores(input: CombinedScoreInput): CombinedScore {
  const weights = input.reach ? WEIGHTS_WITH_REACH : WEIGHTS_WITHOUT_REACH;
  const overallScore = Math.round(
    input.hookStrength.score * weights.hookStrength +
      input.retentionRisk.score * weights.retentionRisk +
      input.timing.score * weights.timing +
      input.formatFit.score * weights.formatFit +
      (input.reach ? input.reach.score * weights.reach : 0)
  );

  return { ...input, overallScore };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/diagnostic/score.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostic/score.ts tests/unit/lib/diagnostic/score.test.ts
git commit -m "feat(diagnostic): rebalance score weights to include Reach"
```

---

### Task 6: Wire Reach into report generation and the Claude prompt

**Files:**
- Modify: `lib/diagnostic/report.ts`
- Modify: `lib/integrations/claude.ts`
- Modify: `tests/fakes/claude.fake.ts` (only if it hardcodes the `scores` shape — check first)
- Test: `tests/unit/lib/diagnostic/report.test.ts`

**Interfaces:**
- Consumes: `scoreReach` (Task 4), `combineScores`'s new `reach` parameter (Task 5).
- Produces: `DiagnosticPostStats.followerCount?: number`, consumed by Task 7 (`handler.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/diagnostic/report.test.ts`:

```ts
it('computes a Reach score when followerCount is provided', async () => {
  const claudeClient = createFakeClaudeReportClient();
  const report = await generateDiagnosticReport({
    platform: 'instagram',
    postStats: {
      captionOrTitle: 'Every change to the wanted system',
      publishedAt: '2026-08-29T04:00:00Z',
      durationSeconds: 20,
      viewCount: 34_000,
      likeCount: 500,
      commentCount: 12,
      followerCount: 5_400_000,
    },
    claudeClient,
  });

  expect(report.scores.reach).not.toBeNull();
  expect(report.scores.reach?.label).toBe('weak');
});

it('leaves Reach null when followerCount is not provided, and does not throw', async () => {
  const claudeClient = createFakeClaudeReportClient();
  const report = await generateDiagnosticReport({
    platform: 'tiktok',
    postStats: {
      captionOrTitle: 'Untitled',
      publishedAt: '2026-08-11T19:00:00Z',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    },
    claudeClient,
  });

  expect(report.scores.reach).toBeNull();
});

it('leaves Reach null when followerCount is 0', async () => {
  const claudeClient = createFakeClaudeReportClient();
  const report = await generateDiagnosticReport({
    platform: 'tiktok',
    postStats: {
      captionOrTitle: 'Untitled',
      publishedAt: '2026-08-11T19:00:00Z',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
      followerCount: 0,
    },
    claudeClient,
  });

  expect(report.scores.reach).toBeNull();
});
```

Check `tests/fakes/claude.fake.ts` — if `createFakeClaudeReportClient`'s fake implementation asserts on or hardcodes the exact `scores` object shape passed to it, no change should be needed since Task 6 only *adds* an optional field; if it does something stricter, loosen it to accept the new optional `reach` key. Read the file first before assuming either way.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/diagnostic/report.test.ts`
Expected: FAIL — `report.scores.reach` is `undefined` (property doesn't exist / `combineScores` isn't being called with a `reach` argument yet).

- [ ] **Step 3: Implement**

In `lib/diagnostic/report.ts`, add the import and update `DiagnosticPostStats`:

```ts
import { scoreReach } from './reach';
```

```ts
export interface DiagnosticPostStats {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  saveCount?: number;
  followerCount?: number;
}
```

In `generateDiagnosticReport`, compute `reach` and pass it through:

```ts
const reach = postStats.followerCount && postStats.followerCount > 0
  ? scoreReach({ viewCount: postStats.viewCount, followerCount: postStats.followerCount })
  : null;

const scores = combineScores({
  hookStrength: scoreHookStrength(hookStrengthInput),
  retentionRisk: scoreRetentionRisk(retentionRiskInput),
  timing: scoreTiming(timingInput),
  formatFit: scoreFormatFit(formatFitInput),
  reach,
});
```

Update the call to `params.claudeClient.generateDiagnosticReport` to conditionally include reach:

```ts
const generated = await params.claudeClient.generateDiagnosticReport({
  platform,
  postSummary: postStats.captionOrTitle,
  scores: {
    hookStrength: { value: scores.hookStrength.score, label: scores.hookStrength.label },
    retentionRisk: { value: scores.retentionRisk.score, label: scores.retentionRisk.label },
    timing: { value: scores.timing.score, label: scores.timing.label },
    formatFit: { value: scores.formatFit.score, label: scores.formatFit.label },
    ...(scores.reach ? { reach: { value: scores.reach.score, label: scores.reach.label } } : {}),
  },
});
```

In `lib/integrations/claude.ts`, add the optional field to `ReportGenerationInput` and update the prompt template:

```ts
export interface ReportGenerationInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postSummary: string;
  scores: {
    hookStrength: ReportScoreSummary;
    retentionRisk: ReportScoreSummary;
    timing: ReportScoreSummary;
    formatFit: ReportScoreSummary;
    reach?: ReportScoreSummary;
  };
}
```

```ts
userContent: `Platform: ${input.platform}\nPost summary: ${input.postSummary}\nHook strength: ${input.scores.hookStrength.value} (${input.scores.hookStrength.label})\nRetention risk: ${input.scores.retentionRisk.value} (${input.scores.retentionRisk.label})\nTiming: ${input.scores.timing.value} (${input.scores.timing.label})\nFormat fit: ${input.scores.formatFit.value} (${input.scores.formatFit.label})${input.scores.reach ? `\nReach: ${input.scores.reach.value} (${input.scores.reach.label})` : ''}\n\nRespond as JSON: {"headline": string, "explanation": string}`,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/diagnostic/report.test.ts`
Expected: PASS

Then run the full diagnostic test suite to catch any ripple effects from `combineScores` now requiring `reach`:

Run: `npx vitest run tests/unit/lib/diagnostic`
Expected: PASS (fix any other call site this plan didn't anticipate — search `combineScores(` across the repo if something fails)

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostic/report.ts lib/integrations/claude.ts tests/unit/lib/diagnostic/report.test.ts
git commit -m "feat(diagnostic): wire Reach into report generation and the Claude prompt"
```

---

### Task 7: Thread follower count through the handler and persist `reach_score`

**Files:**
- Modify: `lib/diagnostic/handler.ts`
- Modify: `app/api/diagnostic/route.ts`
- Test: `tests/unit/lib/diagnostic/handler.test.ts`

**Interfaces:**
- Consumes: `SocialPostMetadata.followerCount` (Task 2), `VideoMetadata.channelId` + `getChannelSubscriberCount` (Task 3), `DiagnosticPostStats.followerCount` (Task 6).
- Produces: nothing further downstream — this is the final wiring task.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/diagnostic/handler.test.ts`. First check `tests/fakes/scraper.fake.ts` and `tests/fakes/youtube.fake.ts`'s exact override signatures (from Tasks 2 and 3) to call them correctly:

```ts
it('threads TikTok/Instagram followerCount through to the saved report', async () => {
  const scraperClient = createFakeScraperClient({ followerCount: 5_400_000, viewCount: 34_000, likeCount: 500 });
  let savedReport: any;
  const deps = makeDeps({
    scraperClient,
    saveDiagnostic: async ({ report }) => {
      savedReport = report;
      return { id: 'diagnostic-1' };
    },
  });

  await handleDiagnosticRequest(deps, {
    profileId: 'profile-1',
    ip: '203.0.113.1',
    url: 'https://www.tiktok.com/@user/video/123',
  });

  expect(savedReport.scores.reach).not.toBeNull();
});

it('fetches YouTube subscriber count via channelId and threads it through', async () => {
  const youtubeClient = createFakeYouTubeClient({ channelId: 'UCabc123', viewCount: 5_908_881 }, [], undefined, 496_000);
  let savedReport: any;
  const deps = makeDeps({
    youtubeClient,
    saveDiagnostic: async ({ report }) => {
      savedReport = report;
      return { id: 'diagnostic-1' };
    },
  });

  await handleDiagnosticRequest(deps, {
    profileId: 'profile-1',
    ip: '203.0.113.1',
    url: 'https://www.youtube.com/watch?v=abc123',
  });

  expect(savedReport.scores.reach).not.toBeNull();
});
```

This matches Task 3's fake signature: `createFakeYouTubeClient(overrides, channelUploads, channelStats, subscriberCount)` — the 4th positional argument (`496_000`) is the subscriber count `getChannelSubscriberCount` will return.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/diagnostic/handler.test.ts`
Expected: FAIL — `savedReport.scores.reach` is `null` because `handler.ts` doesn't read `followerCount` yet.

- [ ] **Step 3: Implement**

In `lib/diagnostic/handler.ts`, inside `handleDiagnosticRequest`, update the YouTube branch to fetch subscriber count and the TikTok/Instagram branch to pass through `followerCount`:

```ts
const youtubeId = deps.youtubeClient.extractVideoId(context.url);
if (youtubeId) {
  platform = 'youtube';
  const metadata = await deps.youtubeClient.getVideoMetadata(youtubeId);
  const subscriberCount = await deps.youtubeClient.getChannelSubscriberCount(metadata.channelId);
  postStats = {
    captionOrTitle: metadata.title,
    publishedAt: metadata.publishedAt,
    durationSeconds: metadata.durationSeconds,
    viewCount: metadata.viewCount,
    likeCount: metadata.likeCount,
    commentCount: metadata.commentCount,
    followerCount: subscriberCount ?? undefined,
  };
} else {
  const detected = deps.scraperClient.detectPlatform(context.url);
  if (!detected) {
    await releaseIfNeeded(deps.rateLimitStore, eventId);
    return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram URL.' } };
  }
  platform = detected;
  const post = await deps.scraperClient.fetchPost(context.url);
  postStats = {
    captionOrTitle: post.caption,
    publishedAt: post.publishedAt,
    durationSeconds: post.durationSeconds,
    viewCount: post.viewCount,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    saveCount: post.saveCount,
    followerCount: post.followerCount,
  };
}
```

In `app/api/diagnostic/route.ts`, add `reach_score` to the `saveDiagnostic` insert:

```ts
.insert({
  profile_id: profileId,
  platform,
  input_url: inputUrl,
  status: 'complete',
  hook_strength_score: report.scores.hookStrength.score,
  retention_risk_score: report.scores.retentionRisk.score,
  timing_score: report.scores.timing.score,
  format_fit_score: report.scores.formatFit.score,
  reach_score: report.scores.reach?.score ?? null,
  overall_score: report.scores.overallScore,
  report_json: report,
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/diagnostic/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — this is the point where any missed call site (e.g. another test file constructing a `CombinedScoreInput` or `DiagnosticPostStats` directly) will surface. Fix forward if anything breaks; do not skip this step.

- [ ] **Step 6: Commit**

```bash
git add lib/diagnostic/handler.ts app/api/diagnostic/route.ts tests/unit/lib/diagnostic/handler.test.ts
git commit -m "feat(diagnostic): thread follower count through the handler and persist reach_score"
```

---

### Task 8: Document the calibration source

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add a Reach section**

Append a new `### Reach / Audience-Fit (lib/diagnostic/reach.ts) — added 2026-09-17` section to this file, following its existing per-platform section style. State plainly: the `reachRatio` thresholds (weak/moderate boundary at 10%, moderate/strong at 200%) are **not** sourced from published research — no industry benchmark exists for reach-as-percent-of-followers — and were instead calibrated interactively against the product owner's own judgment during a live session, cross-checked against a real 20-post sample pulled via Apify across 5 niches. Note explicitly that follower-band segmentation (small accounts vs. large accounts having different natural reach expectations, the way engagement-rate benchmarks already vary by follower tier) was considered but deferred — link to `docs/superpowers/specs/2026-09-17-reach-audience-fit-design.md` for the full rationale.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md
git commit -m "docs: record Reach dimension's calibration source"
```
