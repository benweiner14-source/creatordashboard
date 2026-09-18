# Reach Follower-Band Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalibrate `scoreReach`'s flat weak/moderate=0.1x, moderate/strong=2.0x boundaries into five follower-tier-specific boundary pairs, so that Reach scoring accounts for the fact that "typical" reach-as-percent-of-followers is dramatically different for a small account than a large one.

**Architecture:** A pure internal-constants change inside the existing `lib/diagnostic/reach.ts`. `scoreReach`'s signature, output shape, and every caller are unchanged — `followerCount` is already an input, so tier classification happens entirely inside the function.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md`

## Global Constraints

- Five follower tiers, round power-of-ten cutoffs: `<10,000`, `10,000–100,000`, `100,000–1,000,000`, `1,000,000–10,000,000`, `10,000,000+`.
- Per-tier boundaries (weak/moderate → score 40, moderate/strong → score 70):
  - `<10,000`: 2.372x / 189.557x
  - `10,000–100,000`: 1.023x / 15.445x
  - `100,000–1,000,000`: 0.163x / 1.770x
  - `1,000,000–10,000,000`: 0.078x / 0.555x
  - `10,000,000+`: inherits the `1,000,000–10,000,000` values (2.372/189.557 etc. are not real for this tier — no usable data yet, see spec Non-goals)
- `scoreReach`'s public signature (`ReachInput` → `ScoreResult`), the `reasons` copy, and every file that calls `scoreReach` (`report.ts`, `score.ts`, `handler.ts`) are unchanged. This plan touches exactly one source file plus its test file plus one docs file.
- Out of scope entirely (do not implement): a five-level label vocabulary, any change to `combineScores`/weighting, any change to follower-count fetching, niche-specific recalibration, or real 10M+ calibration.

---

### Task 1: Recalibrate `scoreReach` with per-tier boundaries

**Files:**
- Modify: `lib/diagnostic/reach.ts`
- Modify: `tests/unit/lib/diagnostic/reach.test.ts`

**Interfaces:**
- Consumes: nothing new — `ReachInput { viewCount: number; followerCount: number }` and `ScoreResult` (from `./types`) are unchanged.
- Produces: nothing new for other files — `scoreReach(input: ReachInput): ScoreResult`'s signature and behavior-for-callers contract are identical; only its internal scoring curve changes based on `followerCount`.

- [ ] **Step 1: Replace the test file with the full recalibrated suite**

Replace the entire contents of `tests/unit/lib/diagnostic/reach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreReach } from '@/lib/diagnostic/reach';

describe('scoreReach', () => {
  describe('legacy behavioral checks (recalibrated to per-tier boundaries)', () => {
    it('scores 100K views on 1M followers (10% reach) as 44 under the 1M-10M tier', () => {
      const result = scoreReach({ viewCount: 100_000, followerCount: 1_000_000 });
      expect(result.score).toBe(44);
      expect(result.label).toBe('moderate');
    });

    it('scores 2M views on 1M followers (200% reach) as 90 under the 1M-10M tier', () => {
      const result = scoreReach({ viewCount: 2_000_000, followerCount: 1_000_000 });
      expect(result.score).toBe(90);
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

  describe('per-tier boundaries', () => {
    it('scores exactly the <10K tier weak/moderate boundary (2.372x) as 40', () => {
      const followerCount = 9_999;
      const result = scoreReach({ viewCount: Math.round(2.372 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the <10K tier moderate/strong boundary (189.557x) as 70', () => {
      const followerCount = 9_999;
      const result = scoreReach({ viewCount: Math.round(189.557 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 10K-100K tier weak/moderate boundary (1.023x) as 40', () => {
      const followerCount = 99_999;
      const result = scoreReach({ viewCount: Math.round(1.023 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 10K-100K tier moderate/strong boundary (15.445x) as 70', () => {
      const followerCount = 99_999;
      const result = scoreReach({ viewCount: Math.round(15.445 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 100K-1M tier weak/moderate boundary (0.163x) as 40', () => {
      const followerCount = 999_999;
      const result = scoreReach({ viewCount: Math.round(0.163 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 100K-1M tier moderate/strong boundary (1.770x) as 70', () => {
      const followerCount = 999_999;
      const result = scoreReach({ viewCount: Math.round(1.770 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 1M-10M tier weak/moderate boundary (0.078x) as 40', () => {
      const followerCount = 9_999_999;
      const result = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 1M-10M tier moderate/strong boundary (0.555x) as 70', () => {
      const followerCount = 9_999_999;
      const result = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('10M+ inherits the 1M-10M tier boundaries', () => {
      const followerCount = 50_000_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
    });
  });

  describe('tier boundary edges', () => {
    it('applies the <10K tier to a follower count of exactly 9,999', () => {
      // At the same 5.0x ratio, the <10K tier's boundaries (2.372/189.557) score
      // this lower than the 10K-100K tier's boundaries (1.023/15.445) would.
      const result = scoreReach({ viewCount: 9_999 * 5, followerCount: 9_999 });
      expect(result.score).toBe(45);
    });

    it('applies the 10K-100K tier to a follower count of exactly 10,000', () => {
      const result = scoreReach({ viewCount: 10_000 * 5, followerCount: 10_000 });
      expect(result.score).toBe(58);
    });
  });

  describe('real-content calibration reproductions', () => {
    it('reproduces the @gamingclips513 gut-check example: 201.7K views on 3,962 followers scores 61 (moderate)', () => {
      const result = scoreReach({ viewCount: 201_700, followerCount: 3_962 });
      expect(result.score).toBe(61);
      expect(result.label).toBe('moderate');
    });

    it('reproduces the @king.gaming3483 gut-check example: 8,929 views on 4,444 followers scores 39 (weak)', () => {
      const result = scoreReach({ viewCount: 8_929, followerCount: 4_444 });
      expect(result.score).toBe(39);
      expect(result.label).toBe('weak');
    });
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/reach.test.ts`
Expected: FAIL — the current flat-curve implementation returns the old scores (e.g. the first "legacy" test expects 44 but the current code returns 40; the "per-tier boundaries" and "tier boundary edges" tests fail because every tier currently uses the same flat curve; the "real-content calibration reproductions" tests fail because the current code doesn't distinguish follower tiers at all).

- [ ] **Step 3: Replace `lib/diagnostic/reach.ts` with the per-tier implementation**

Replace the entire contents of `lib/diagnostic/reach.ts`:

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
// real posts with the product owner. See
// docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md
// and docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
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

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/reach.test.ts`
Expected: PASS — all 16 tests green.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. This is the point that confirms no other file was relying on `reach.ts`'s old exported constants or exact old scores — `WEAK_MODERATE_BOUNDARY_RATIO`/`MODERATE_STRONG_BOUNDARY_RATIO` were never exported and nothing else in the codebase references them (confirmed during spec review), but this step is the real verification, not the assumption. If anything else fails, it means a hidden dependency on Reach's old scoring existed — fix forward and note it, don't skip this step.

- [ ] **Step 6: Commit**

```bash
git add lib/diagnostic/reach.ts tests/unit/lib/diagnostic/reach.test.ts
git commit -m "feat(diagnostic): recalibrate Reach scoring with per-follower-tier boundaries"
```

---

### Task 2: Document the recalibration in the benchmark-sources doc

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Replace the existing Reach section**

The file currently has this section (added when Reach originally shipped):

```
### Reach / Audience-Fit (`lib/diagnostic/reach.ts`) — added 2026-09-17
- **Formula and thresholds: NOT sourced from published research.** ...
- **Follower-band segmentation considered but deferred:** ...
```

Replace the entire `### Reach / Audience-Fit (...)` section (both bullet points under it) with:

```markdown
### Reach / Audience-Fit (`lib/diagnostic/reach.ts`) — added 2026-09-17, recalibrated 2026-09-18

- **Formula and thresholds: NOT sourced from published research.** No industry-wide benchmark exists for reach-as-percent-of-followers — the concept is too niche and platform-specific (reach/views vary enormously depending on algorithm, posting time, content type, and follower composition).
- **Original launch (2026-09-17):** one flat weak/moderate boundary (`reachRatio = 0.1` → score 40) and moderate/strong boundary (`reachRatio = 2.0` → score 70), calibrated interactively against the product owner's gut feel on 20 real TikTok posts across 5 niches. Flagged at the time as a known gap: "the same absolute view count feels very different on a 10K-follower account vs. a 1M-follower account" — follower-band segmentation was considered but deferred pending real data.
- **Recalibration (2026-09-18):** confirmed the flat-curve gap was real and significant. A live 195-post sample (Apify, 11 general niches) showed the *median* reach ratio for accounts under 10,000 followers is ~51x — several times past the original flat curve's moderate/strong boundary of 2.0x. Since this product's target audience is creators under 5,000 followers, the flat curve was close to non-discriminating for its own intended users (nearly every post would read "strong" regardless of whether it actually did well for that specific account).
- **New method: five follower tiers** (`<10,000`, `10,000–100,000`, `100,000–1,000,000`, `1,000,000–10,000,000`, `10,000,000+`), each with its own weak/moderate (25th percentile of that tier's real reach ratios) and moderate/strong (60th percentile) boundary. The specific percentiles (25th/60th, not the more obvious median/90th-percentile) were reached by iterating against real content with the product owner, not chosen a priori — an initial median/90th-percentile proposal was gut-checked against real posts and found too conservative for small accounts (a real, in-niche `<10K`-follower post at 50.9x reach felt like it should score "strong," not sit at the bottom of "moderate"); both the resulting weak/moderate and moderate/strong boundaries were independently validated against real posts and real links in two separate rounds before being finalized. Full methodology: `docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md`.
- **`10,000,000+` is a placeholder, not a measurement:** the spike sample had exactly one usable post above 10M followers — nowhere near enough to calibrate. It inherits the `1,000,000–10,000,000` tier's boundaries until real data exists. This tier is rare for this product's actual (sub-5,000-follower) audience, so the cost of it being wrong is low.
- **Known limitation — search-sampling bias:** all 195 posts came from TikTok's search/relevance ranking, which surfaces already-at-least-somewhat-relevant content, not a random cross-section of everything ever posted. If genuinely "typical" performance (including posts that got no traction at all) is lower than what search results show, these percentiles are systematically inflated. Not correctable without a fundamentally different sampling method — flagged honestly, not fixed.
- **Five-level label vocabulary (weak/okay/solid/strong/excellent) raised and explicitly deferred:** `ScoreLabel` (`lib/diagnostic/types.ts`) is shared by all five diagnostic dimensions, not owned by Reach — expanding it would mean recalibrating Hook Strength, Retention Risk, Timing, and Format Fit too. A legitimate future initiative, but separate and much larger than this recalibration.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md
git commit -m "docs: record Reach follower-band recalibration"
```
