# Reach / Audience-Fit Diagnostic Dimension Design Spec

**Date:** 2026-09-17
**Classification:** Architectural (per `brainstorming`) — new scoring dimension, DB migration, new per-platform data fetching, rebalanced weighting. Reuses the existing 4-dimension diagnostic pipeline's shape.
**Status:** Approved for planning. Decisions below were reached conversationally with the product owner (a 10+ year industry veteran), grounded against a real 20-post sample pulled live via Apify across 5 niches during this session's calibration exercise. **Superseded in part on 2026-09-18:** the flat weak/moderate (0.1x) and moderate/strong (2.0x) boundary constants described in Decision 2 and implemented in Section (below) were replaced by five follower-count-tier-specific boundary pairs — see `docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md`. Everything else in this spec (the dimension's existence, formula shape, weighting, missing-data handling, platform data-fetching) is unchanged and still current.

## What this is

A 5th diagnostic scoring dimension, alongside the existing Hook Strength, Retention Risk, Timing, and Format Fit. It answers a question none of the other four can: **did this post reach an audience proportionate to the account's size?** Discovered via a real production bug report — an NBA 2K Instagram Reel (5.4M followers, 500 likes, 34K views) scored as "moderate," because every existing dimension only measures engagement-rate-among-viewers, never reach relative to audience size. Confirmed as a systemic gap, not a one-off, against the 20-post calibration sample: 8 of 20 real posts (all 4 finance-account posts, `djthatabguy`, and the original NBA 2K case) scored misleadingly moderate-to-strong despite reach ranging from 0.2%-20% of their following.

## Decisions already made (inputs to this spec, not open questions)

1. **A dedicated 5th score dimension**, not folded into Hook Strength — reach ("did this get distributed") and engagement-rate ("did the people who saw it react") are genuinely different questions; collapsing them into one number was rejected as making Hook Strength's meaning muddier over time.
2. **Formula: `reachRatio = viewCount / followerCount`, log-scaled.** Weak/moderate boundary at `reachRatio = 0.1` (10% of followers) → score 40. Moderate/strong boundary at `reachRatio = 2.0` (200% of followers) → score 70. This curve was iterated interactively against the product owner's own gut read on real numbers (see Calibration below) — it is **not** sourced from published industry benchmarks the way the other four dimensions' thresholds are (see `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`), because no such benchmark exists for reach-as-percent-of-followers. Flag this honestly in that doc as part of implementation.
3. **Wording must not claim calendar-based rarity** ("best video in 5 years"). The product owner's own framing of "great" reach naturally escalated into rarity claims a fixed ratio formula cannot honestly verify — that requires comparing against a specific account's own historical distribution, which is out of scope here (see Non-goals, V2).
4. **Weighting: Hook Strength 23%, Retention Risk 23%, Reach 23%, Timing 15.5%, Format Fit 15.5%** (sums to 100%; adjusted from the conversationally-proposed 23/23/23/15/15, which summed to 99%). Reach is weighted equal to the two existing highest-weighted dimensions, and Timing/Format Fit are both reduced from their prior 20% — partly to make room, partly because the calibration exercise separately surfaced Format/Timing overriding an otherwise-correct read (e.g., a 6,096%-reach viral clip dragged to "moderate" purely by video length and off-peak posting time).
5. **Missing follower-count data: omit Reach, reweight the other 4 back to their original 30/30/20/20 split.** Never fail the whole diagnostic over a secondary signal being unavailable — matches this codebase's existing pattern for optional signals (e.g. TikTok's share/save bonus in `hook-strength.ts` simply doesn't apply when absent).
6. **TikTok gets follower count for free** — already present, unused, in the same Apify response `fetchPost` already receives (`authorMeta.fans`). **Instagram needs one additional, cheap Apify call** (`resultsType: "details"` on the post owner's profile URL) since Instagram's post-level scrape does not include follower count at all — confirmed by a live test pull during this session. **YouTube needs one additional `channels.list` call** by channel ID (videos.list's snippet already returns `channelId`).

## Why (calibration methodology)

The formula and thresholds were derived by: (a) pulling 20 real TikTok posts across 5 niches (comedy, finance, cooking, GTA6/gaming, fitness) live via `clockworks/tiktok-scraper`, (b) running them through the *existing* 4-dimension scorer to find mismatches, (c) walking through each post's real content with the product owner for a qualitative read, and (d) iterating the reach formula against the product owner's own stated "gut feel" for what view counts mean at a given follower count (e.g., for a 1M-follower account: 300K views = "happy," 2M = "very solid," 8M = "ecstatic"). This is a legitimate but explicitly informal calibration method — see Non-goals for the planned rigorous follow-up.

## Non-goals (explicitly deferred, do not fold into this build)

- **V2: historical/percentile-based comparison** ("this is your best video in 3 months") — requires comparing a post against a specific account's own historical distribution, not a fixed ratio. The `diagnostics` table already accumulates per-profile history, so this becomes possible over time regardless; a bulk historical dataset (offered by the product owner, not yet provided) would accelerate it. Separate future brainstorm.
- **"Post too new to score reliably"** — discovered during calibration (a post 1 hour old scored as if mature) but is a pre-existing gap across all dimensions, not specific to Reach. Separate fix.
- **Visual/audio content analysis** (on-screen text density, aspect-ratio/repurposed-broadcast detection, hook-content recognition) — a much larger, separate initiative, paused mid-brainstorm to do this calibration exercise and build Reach first. Resume separately.
- **Comment-content analysis, fake-engagement/bot detection, trending-sound velocity, native-editor-app boost, episodic-content signal, Substack strategy-newsletter ingestion** — all surfaced during the calibration exercise as real, distinct ideas. Parked, not scoped here.
- **UI changes** — none needed. `app/diagnostic/[id]/page.tsx` today renders only a headline, overall score, and Claude's prose explanation; no per-dimension score cards exist to update.

---

## 1. Data model

New migration, adding one nullable column (nullable because Reach can be omitted per decision 5):

```sql
alter table public.diagnostics
  add column reach_score integer;
```

`report_json`'s shape (not enforced by the DB, just written by the app) gains an optional `reach: { score: number; label: ScoreLabel; reasons: string[] } | null` entry alongside the existing four.

## 2. Fetching: follower count per platform

**`lib/integrations/scraper.ts`** — `SocialPostMetadata` (the `fetchPost` return type, used by Diagnostic) gains:

```ts
export interface SocialPostMetadata {
  // ...existing fields unchanged...
  followerCount?: number; // best-effort; absent if unavailable for this platform/account
}
```

- **TikTok**: read directly off the existing `run-sync-get-dataset-items` response already fetched by `fetchPost` — `item.authorMeta?.fans`. No new request.
- **Instagram**: `apify~instagram-scraper`'s post-level scrape does not include follower count (confirmed by a live test call this session — the field is present in the schema but always empty on post items). `fetchPost` needs a second, additional Apify call after the post scrape succeeds: `{ resultsType: "details", directUrls: [profileUrl] }` where `profileUrl` is built from the post item's `ownerUsername` (`https://www.instagram.com/${ownerUsername}/`), reusing the existing `run-sync-get-dataset-items` pattern. Read `followersCount` off that response. If this second call fails, catch it and proceed with `followerCount: undefined` — **never let a failed follower-count lookup fail the whole diagnostic** (this is a stricter same-spirit guard as decision 5, applied at the fetch layer too).

**`lib/integrations/youtube.ts`**:
- `VideoMetadata` gains `channelId: string` (already present in `videos.list`'s `snippet.channelId`, currently discarded by `mapVideoItem`).
- New `YouTubeClient` method, additive (no existing signature changes):
  ```ts
  getChannelSubscriberCount(channelId: string): Promise<number | null>; // null = hidden by channel owner
  ```
  Implementation: `channels.list?id={channelId}&part=statistics` (by ID, not `forHandle` — distinct from the existing `getChannelStats(handle)` used by Watchlist, which resolves by handle because that's what a Watchlist entry stores; Diagnostic only ever has a `channelId` from a video lookup). Maps `hiddenSubscriberCount: true` to `null`, same convention as `getChannelStats`.

## 3. Scoring (`lib/diagnostic/reach.ts`, new file)

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
// for a 1M-follower account (2026-09-17 calibration session). Revisit alongside a
// historical/percentile-based comparison (V2) once real per-account data exists — see
// this file's design spec, Non-goals.
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

No divide-by-zero guard needed on `followerCount` itself (only called when a positive follower count was actually obtained — see §4); `views` is floored at 1 the same way `computeEngagementRate` floors `viewCount`.

## 4. Wiring into the report (`lib/diagnostic/report.ts`, `lib/diagnostic/score.ts`)

`DiagnosticPostStats` (report.ts) gains `followerCount?: number`, threaded from `SocialPostMetadata`/`VideoMetadata` inside `handleDiagnosticRequest` (`lib/diagnostic/handler.ts`), which builds `postStats` for both branches today. The TikTok/Instagram branch reads `post.followerCount` straight off `scraperClient.fetchPost`'s result (§2 handles the fetch). The YouTube branch additionally calls `youtubeClient.getChannelSubscriberCount(metadata.channelId)` right after `getVideoMetadata`, since subscriber count isn't part of that call's response.

`generateDiagnosticReport` (report.ts):
```ts
const reach = postStats.followerCount && postStats.followerCount > 0
  ? scoreReach({ viewCount: postStats.viewCount, followerCount: postStats.followerCount })
  : null;

const scores = combineScores({
  hookStrength: scoreHookStrength(hookStrengthInput),
  retentionRisk: scoreRetentionRisk(retentionRiskInput),
  timing: scoreTiming(timingInput),
  formatFit: scoreFormatFit(formatFitInput),
  reach, // null when unavailable
});
```

`combineScores` (score.ts) — `CombinedScoreInput.reach` becomes `ScoreResult | null`; weights branch on its presence:

```ts
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

`CombinedScore`'s `reach` field is `ScoreResult | null`, threaded through to `saveDiagnostic`'s insert as `reach_score: scores.reach?.score ?? null` and into `report_json` as-is.

## 5. Claude prompt (`lib/integrations/claude.ts`)

`GenerateDiagnosticReportInput.scores` gains an optional `reach?: { value: number; label: string }`. The prompt's `userContent` template conditionally appends a `Reach: {value} ({label})` line when present, so the generated explanation can reference it — omitted entirely (not "Reach: unknown") when the dimension wasn't computed, so Claude isn't prompted to comment on absent data.

## 6. Error handling

- Instagram follower-count lookup fails → caught in `scraper.ts`, `followerCount` left `undefined`, diagnostic proceeds without Reach (decision 5). Logged, not thrown.
- YouTube `getChannelSubscriberCount` fails or channel has hidden its count (`null`) → same graceful omission.
- `followerCount` present but `0` (edge case, e.g. a brand-new/edge-case account) → treated as unavailable (guarded by the `> 0` check in §4), not a division by zero.
- Every other existing error path in `handleDiagnosticRequest`/`fetchPost`/`getVideoMetadata` is unchanged.

## 7. Testing plan

- Unit: `lib/diagnostic/reach.test.ts` — boundary cases at `reachRatio` 0.1 (score 40) and 2.0 (score 70), clamping at the 0 and 100 extremes, a few real values from the calibration sample (e.g. CNBC's 0.2% → weak, `caralinerosee`'s 53,787% → 100/strong).
- Unit: `lib/diagnostic/score.test.ts` — new cases for `reach: null` (uses the original 30/30/20/20 weights) vs. `reach` present (uses the new weights), confirming both weight sets sum correctly.
- Unit: `lib/integrations/scraper.test.ts` — TikTok `fetchPost` maps `authorMeta.fans` to `followerCount`; Instagram `fetchPost` makes the second `details` call and maps `followersCount`, and gracefully omits `followerCount` (not throwing) when that second call fails.
- Unit: `lib/integrations/youtube.test.ts` — `getChannelSubscriberCount` cases: normal, hidden-subscriber-count (`null`), channel-not-found.
- Unit: `lib/diagnostic/report.test.ts` / `handler.test.ts` — full report generation with and without a resolvable follower count, confirming `reach` is `null` end-to-end (not a thrown error) when omitted.
- Update `tests/fakes/scraper.fake.ts` and `tests/fakes/youtube.fake.ts` to support the new optional field/method.
- Migration test case appended to `tests/unit/supabase/migrations.test.ts` for the new `reach_score` column.
- **Update `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`** in the same change (per that file's own stated convention) — add a Reach section documenting that its thresholds are calibration-derived, not literature-sourced, per decision 2 above.
