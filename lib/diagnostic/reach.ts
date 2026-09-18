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
