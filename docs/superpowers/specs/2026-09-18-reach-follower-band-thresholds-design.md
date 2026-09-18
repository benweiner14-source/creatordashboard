# Reach Follower-Band Thresholds Design Spec

**Date:** 2026-09-18
**Classification:** Bounded (per `brainstorming`) — recalibrates an existing scoring function's internal constants; no new files, no new consumers, no interface changes to anything outside `lib/diagnostic/reach.ts`.
**Status:** Approved for planning. Decisions below were reached conversationally with the product owner, grounded against a real 195-post sample pulled live via Apify and validated against real content in two rounds of gut-checking.

## What this is

A recalibration of `scoreReach`'s two boundary constants (`WEAK_MODERATE_BOUNDARY_RATIO`, `MODERATE_STRONG_BOUNDARY_RATIO`) from one flat pair shared by every account size into five follower-tier-specific pairs. The dimension's shape, output type, and every other file that calls it are unchanged — this is a pure internal-constants swap inside `lib/diagnostic/reach.ts`.

**Why this exists:** the flat curve was already flagged as a known gap when Reach shipped (`docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`'s Reach section: "follower-band segmentation considered but deferred... revisit once real diagnostic usage data exists"). A live check confirmed the gap is real and large: a 195-post real-data pull showed the *median* reach ratio for accounts under 10,000 followers is ~51x — several times past the flat curve's old moderate/strong boundary of 2.0x. Under the flat curve, this product's actual target audience (creators under 5,000 followers, per this app's own system prompt) would see Reach read "strong" on almost every post regardless of whether that specific post did well or badly for them — the dimension was close to non-discriminating for its own intended users.

## Decisions already made (inputs to this spec, not open questions)

1. **Five follower tiers, round power-of-ten cutoffs:** `<10,000`, `10,000–100,000`, `100,000–1,000,000`, `1,000,000–10,000,000`, `10,000,000+`. Tested whether the real data clustered into different natural breakpoints — it didn't; the ratio-vs-followers relationship looks continuous/log-linear rather than clustered, so round cutoffs were kept rather than chasing noise in the scatter.
2. **Per-tier boundary rule: `weak/moderate = tier's own 25th percentile`, `moderate/strong = tier's own 60th percentile`.** Not the tier's median/90th-percentile, and not one global rule copied from the original flat curve's ad-hoc thresholds — these two percentiles were reached by iterating against real examples (see Calibration below), not chosen a priori.
3. **`10,000,000+` inherits the `1,000,000–10,000,000` tier's boundaries as a placeholder.** The spike sample landed exactly one usable post above 10M followers — nowhere near enough to derive a real boundary. Explicitly flagged as unvalidated; revisit once real data exists (this tier is rare in practice — see Non-goals).
4. **No change to the weak/moderate/strong label vocabulary.** A five-level label scheme (weak/okay/solid/strong/excellent) was raised during calibration — rejected for this change specifically because `ScoreLabel` (`lib/diagnostic/types.ts`) is shared by all five diagnostic dimensions, not owned by Reach; changing it would mean re-calibrating Hook Strength, Retention Risk, Timing, and Format Fit's thresholds too. That is a legitimate future initiative but a separate, much larger one — not in scope here.
5. **No change to `scoreReach`'s public signature, `combineScores`, `report.ts`, `handler.ts`, or any other consumer.** `followerCount` is already an input to `scoreReach` today; tier classification happens entirely inside the function using that existing input. Every other file in the Reach call chain is untouched.
6. **This is a second, explicitly informal calibration pass — same honesty standard as the first.** Like the original flat curve, these numbers are not sourced from published research (none exists for this). They are grounded in more real data than the original launch (195 real posts vs. the original 20) and validated against real content twice, but this is still a single spike sample with known sampling bias (see Non-goals) — not a rigorous, repeatable calibration.

## Why (calibration methodology)

1. Pulled 195 real TikTok posts live via `clockworks/tiktok-scraper`'s search mode, across 11 general niches (not GTA6-only — chosen to get enough volume and follower-count spread quickly; niche was not used as a variable), deduplicated by post ID.
2. Computed `reachRatio = views / followerCount` for every post with both fields present, bucketed by the five follower tiers above.
3. **Round 1:** proposed `weak/moderate = tier median, moderate/strong = tier 90th percentile` (mirroring the shape of the original flat curve's semantics: "moderate = typical for your size," "strong = clearly outperforming your peer group"). Gut-checked against 8 real posts (median example + p90 example per tier, with real captions and links to the actual videos). The product owner's read: a real `<10K`-follower gaming clip at the tier's exact median (50.91x reach) felt like it should already score "strong," not sit at the very bottom of "moderate" (score 40) — the median anchor was too conservative.
4. **Iteration:** tried shifting the moderate/strong boundary down from p90 in steps (p90 → p60 → p50) against that same real example. p50 (the median itself) is the literal boundary the post sits at — using it as the moderate/strong cutoff is mathematically the only way to make that exact post "strong," but it implies roughly half of an already-successful-content sample would score "strong," which felt too generous. p60 was the accepted middle ground: the same real post moved from score 40 ("moderate," bottom of the band) to score 61 ("moderate," comfortably above typical but not yet "strong") — accepted as a real improvement without over-correcting.
5. **Round 2:** the weak/moderate boundary (originally set at each tier's median) had never itself been checked against a real example — only inferred by symmetry with the original flat curve's shape. Re-anchored weak/moderate at each tier's 25th percentile and re-ran the gut-check with a new set of real posts near that boundary (again with real captions and links), this time also re-showing the median and the original p90 reference point for continuity. Product owner's read on a real `<10K` gaming clip landing at score 39 (2.0x reach, just under the boundary into "weak"): confirmed as the correct feel.
6. Both boundaries are now real-content-validated, not just statistically derived.

## Final thresholds

| Follower tier | n (spike sample) | weak/moderate boundary (score 40) | moderate/strong boundary (score 70) |
|---|---|---|---|
| `<10,000` | 31 | 2.372x | 189.557x |
| `10,000–100,000` | 82 | 1.023x | 15.445x |
| `100,000–1,000,000` | 56 | 0.163x | 1.770x |
| `1,000,000–10,000,000` | 25 | 0.078x | 0.555x |
| `10,000,000+` | 1 (insufficient) | 0.078x *(inherited)* | 0.555x *(inherited)* |

## Non-goals (explicitly deferred, do not fold into this build)

- **`10,000,000+` real calibration.** Inheriting the `1M–10M` tier's boundaries is a placeholder, not a measurement. This tier is rare for this product's actual audience (creators under 5,000 followers), so the cost of it being wrong is low — revisit if/when real usage data or a deliberately-targeted mega-account pull exists.
- **Five-level label vocabulary (weak/okay/solid/strong/excellent).** Raised during calibration, explicitly deferred as a separate, cross-cutting initiative touching all five diagnostic dimensions — not this change. See decision 4.
- **Search-sampling bias correction.** All 195 posts came from TikTok's search/relevance ranking, which surfaces already-at-least-somewhat-relevant content, not a random cross-section of everything ever posted. If real "typical" performance (including posts that got no traction at all) is actually lower than what search results show, these percentiles are systematically inflated. Not correctable without a fundamentally different sampling method (e.g., full profile crawls of a random creator sample) — flagged honestly, not fixed here.
- **Niche-specific recalibration (e.g., GTA6/gaming-only thresholds).** The spike sample spans 11 general niches; whether gaming specifically behaves differently from cooking/finance/beauty was not checked. Revisit if a gaming-specific sample ever becomes available.
- **Any change to `combineScores`, weighting, or the `overall_score` calculation.** Untouched — this spec only changes what `scoreReach` returns for a given input, not how it's weighted afterward.
- **Any change to the follower-count *fetching* logic** (`lib/integrations/scraper.ts`, `lib/integrations/youtube.ts`) — already built and working; this spec only changes what happens to a follower count once `scoreReach` has it.

---

## 1. Implementation (`lib/diagnostic/reach.ts`, existing file)

Replace the two global constants with a per-tier boundary table and a lookup function. The public `scoreReach(input: ReachInput): ScoreResult` signature is unchanged.

```ts
import { labelForScore, type ScoreResult } from './types';

export interface ReachInput {
  viewCount: number;
  followerCount: number; // caller (report.ts) only invokes this when a follower count was actually obtained
}

interface ReachTierBoundary {
  maxFollowers: number; // exclusive upper bound; Infinity for the top tier
  weakModerateBoundaryRatio: number;
  moderateStrongBoundaryRatio: number;
}

// Per-tier boundaries: weak/moderate = tier's own 25th percentile of real
// reachRatio, moderate/strong = tier's own 60th percentile. NOT sourced from
// published research — no such benchmark exists for reach-as-percent-of-
// followers, segmented by follower count. Calibrated against a real 195-post
// sample (live Apify pull, 2026-09-18) and validated in two rounds against
// real posts with the product owner (see
// docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md).
// The 10M+ row inherits the 1M-10M row's values as a placeholder — the spike
// sample had only one usable post above 10M followers, nowhere near enough
// to calibrate; revisit once real data exists for this tier.
const REACH_TIER_BOUNDARIES: ReachTierBoundary[] = [
  { maxFollowers: 10_000, weakModerateBoundaryRatio: 2.372, moderateStrongBoundaryRatio: 189.557 },
  { maxFollowers: 100_000, weakModerateBoundaryRatio: 1.023, moderateStrongBoundaryRatio: 15.445 },
  { maxFollowers: 1_000_000, weakModerateBoundaryRatio: 0.163, moderateStrongBoundaryRatio: 1.770 },
  { maxFollowers: 10_000_000, weakModerateBoundaryRatio: 0.078, moderateStrongBoundaryRatio: 0.555 },
  { maxFollowers: Infinity, weakModerateBoundaryRatio: 0.078, moderateStrongBoundaryRatio: 0.555 },
];

function boundariesForFollowerCount(followerCount: number): ReachTierBoundary {
  return (
    REACH_TIER_BOUNDARIES.find((tier) => followerCount < tier.maxFollowers) ??
    REACH_TIER_BOUNDARIES[REACH_TIER_BOUNDARIES.length - 1]
  );
}

export function scoreReach(input: ReachInput): ScoreResult {
  const { weakModerateBoundaryRatio, moderateStrongBoundaryRatio } = boundariesForFollowerCount(input.followerCount);
  const views = Math.max(input.viewCount, 1);
  const reachRatio = views / input.followerCount;
  const slope = 30 / (Math.log10(moderateStrongBoundaryRatio) - Math.log10(weakModerateBoundaryRatio));
  const rawScore = 40 + (Math.log10(reachRatio) - Math.log10(weakModerateBoundaryRatio)) * slope;
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

No divide-by-zero risk beyond what already exists today: `scoreReach` is only ever invoked by `report.ts` when `followerCount > 0` (unchanged guard, already in place).

## 2. Reason text

The three `reasons` strings are unchanged from the current implementation — they describe the *relationship* between views and followers in relative terms ("several times," "roughly in line," "below what would be expected"), which stays accurate regardless of which tier's boundaries produced the score. No copy change needed.

## 3. Error handling

No change from today's behavior. `boundariesForFollowerCount` always returns a value (the `??` fallback to the last tier makes this total, even though the `.find()` should always match given the last tier's `maxFollowers: Infinity`) — this is defensive, not reachable in normal operation, matching this codebase's existing style of favoring an explicit total function over a possible `undefined`.

## 4. Testing plan

- Unit: `tests/unit/lib/diagnostic/reach.test.ts` (existing file) — add per-tier boundary tests:
  - For each of the 5 tiers: a case at exactly the tier's weak/moderate boundary ratio (expect score 40), a case at exactly the moderate/strong boundary ratio (expect score 70), and a case using a follower count just inside vs. just outside a tier edge (e.g. 9,999 vs. 10,000 followers) to confirm the tier lookup itself is correct, not just the scoring math within one tier.
  - Reproduce the two real gut-check examples that anchored this calibration: `@gamingclips513`-equivalent (viewCount, followerCount such that ratio ≈ 50.91, followerCount < 10,000) should score 61; `@king.gaming3483`-equivalent (ratio ≈ 2.009, followerCount < 10,000) should score 39.
  - Existing tests in this file that used the old flat-curve boundaries (0.1/2.0) need their expected scores recalculated against whichever tier their test `followerCount` falls into — do not leave them asserting the old flat-curve numbers.
  - Keep the existing clamping tests (very low/very high ratio → 0/100) and the "always returns at least one reason" test, updated only if their specific input values land in a different tier now.
- **Update `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`** in the same change — replace the existing Reach section's "follower-band segmentation considered but deferred" line (it now exists) with a summary of this recalibration: the new per-tier thresholds, the 195-post sample size, the two-round real-content validation, and the same honesty caveats as above (informal, search-sampling-biased, 10M+ unvalidated).
