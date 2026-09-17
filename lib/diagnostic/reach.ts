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
