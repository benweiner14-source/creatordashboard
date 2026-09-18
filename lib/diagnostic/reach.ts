import { labelForScore, type ScoreResult } from './types';

export interface ReachInput {
  viewCount: number;
  followerCount: number; // caller (report.ts) only invokes this when a follower count was actually obtained
}

interface ReachAnchor {
  followerCount: number;
  weakModerateBoundaryRatio: number;
  moderateStrongBoundaryRatio: number;
}

interface ReachBoundaries {
  weakModerateBoundaryRatio: number;
  moderateStrongBoundaryRatio: number;
}

// Anchors are the 4 follower-count breakpoints from the original per-tier
// calibration: weak/moderate = tier's own 25th percentile of real
// reachRatio, moderate/strong = tier's own 60th percentile. NOT sourced from
// published research — no such benchmark exists for reach-as-percent-of-
// followers, segmented by follower count. Calibrated against a real 195-post
// sample (live Apify pull, 2026-09-18) and validated in two rounds against
// real posts with the product owner. See
// docs/superpowers/specs/2026-09-18-reach-follower-band-thresholds-design.md
// and docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
//
// Between anchors, boundaries are interpolated linearly in log-log space
// (log10(ratio) vs log10(followerCount)) rather than jumping at the
// breakpoint — the original discrete-tier version let a handful of
// followers swing the score by 20+ points right at a tier edge (e.g. 10K,
// 100K). Below the first anchor and above the last, the nearest anchor's
// value applies flat: the original design's <10K tier and 10M+ tier
// (which inherited the 1M-10M tier's values as a placeholder — the spike
// sample had only one usable post above 10M followers) were already flat
// across their whole range, so this preserves that behavior exactly.
const REACH_ANCHORS: ReachAnchor[] = [
  { followerCount: 10_000, weakModerateBoundaryRatio: 2.372, moderateStrongBoundaryRatio: 189.557 },
  { followerCount: 100_000, weakModerateBoundaryRatio: 1.023, moderateStrongBoundaryRatio: 15.445 },
  { followerCount: 1_000_000, weakModerateBoundaryRatio: 0.163, moderateStrongBoundaryRatio: 1.770 },
  { followerCount: 10_000_000, weakModerateBoundaryRatio: 0.078, moderateStrongBoundaryRatio: 0.555 },
];

function interpolateLog(x: number, x0: number, y0: number, x1: number, y1: number): number {
  const t = (Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0));
  return Math.pow(10, Math.log10(y0) + t * (Math.log10(y1) - Math.log10(y0)));
}

function boundariesForFollowerCount(followerCount: number): ReachBoundaries {
  const first = REACH_ANCHORS[0];
  const last = REACH_ANCHORS[REACH_ANCHORS.length - 1];

  if (followerCount <= first.followerCount) {
    return first;
  }
  if (followerCount >= last.followerCount) {
    return last;
  }

  const upperIndex = REACH_ANCHORS.findIndex((anchor) => followerCount < anchor.followerCount);
  const lower = REACH_ANCHORS[upperIndex - 1];
  const upper = REACH_ANCHORS[upperIndex];

  return {
    weakModerateBoundaryRatio: interpolateLog(
      followerCount,
      lower.followerCount,
      lower.weakModerateBoundaryRatio,
      upper.followerCount,
      upper.weakModerateBoundaryRatio
    ),
    moderateStrongBoundaryRatio: interpolateLog(
      followerCount,
      lower.followerCount,
      lower.moderateStrongBoundaryRatio,
      upper.followerCount,
      upper.moderateStrongBoundaryRatio
    ),
  };
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
      ? ["Your views are well above what's typical for an account your size, meaning this reached well beyond your existing audience."]
      : score >= 40
        ? ["Your views are in the typical range for an account your size — a typical result for content that mostly reached your existing audience."]
        : ["Your views are below what's typical for an account your size, suggesting this post got limited distribution beyond your existing audience."];

  return { score, label: labelForScore(score), reasons };
}
