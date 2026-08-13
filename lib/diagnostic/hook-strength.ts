import { labelForScore, computeEngagementRate, type ScoreResult } from './types';

export interface HookStrengthInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  captionOrTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  // Only ever populated for TikTok (see lib/integrations/scraper.ts) — no
  // sourced numeric ratio exists for how much these should matter, so
  // they're kept out of the calibrated engagementRate/threshold system
  // entirely and only drive the small flat bonus below.
  shareCount?: number;
  saveCount?: number;
}

const HOOK_PATTERN = /(\?|\bhow\b|\bwhy\b|\bwait\b|\bstop\b|\d+)/i;

// Engagement-rate thresholds calibrated per platform. See
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md for full
// sourcing. TikTok: ~7.5% is the average for gaming accounts under 100K
// followers (our target cohort), not exceptional — "strong" is set above
// that. Instagram: ~2.6% is the average of Sprout Social's and Hootsuite's
// Reels-specific figures (2.35%/2.8%) — "moderate" is anchored there.
// YouTube: no sourced engagement-rate benchmark was found (CTR, the
// platform's real ranking-adjacent metric, needs impression data the public
// API doesn't expose) — kept at its original estimate.
const ENGAGEMENT_THRESHOLDS: Record<HookStrengthInput['platform'], { moderate: number; strong: number }> = {
  tiktok: { moderate: 0.03, strong: 0.08 },
  instagram: { moderate: 0.02, strong: 0.04 },
  youtube: { moderate: 0.02, strong: 0.05 },
};

// Maps an engagement rate to a 0-100 base score, anchored so the platform's
// "moderate" threshold lands at 40 (the moderate/weak boundary) and its
// "strong" threshold lands at 70 (the strong/moderate boundary), matching
// labelForScore's buckets.
function engagementRateToScore(engagementRate: number, thresholds: { moderate: number; strong: number }): number {
  const slope = 30 / (thresholds.strong - thresholds.moderate);
  return 40 + (engagementRate - thresholds.moderate) * slope;
}

// TikTok is documented (2026-08 platform-monitoring finding) as weighting
// shares and saves above likes, alongside comments (see
// computeEngagementRate's TIKTOK_COMMENT_WEIGHT). Unlike comments, no
// source gives any numeric ratio for shares/saves at all, and raw share
// counts are typically far rarer than likes — a per-count multiplier big
// enough to matter would be a much bigger guess than the comment weight
// was. So this stays a small, flat, clearly-labeled bonus keyed off a
// ratio (not folded into the calibrated engagementRate/threshold system),
// triggered only when shares+saves are disproportionately high relative to
// likes. See docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const DISTRIBUTION_BONUS_RATIO = 0.05;
const DISTRIBUTION_BONUS_POINTS = 8;

export function scoreHookStrength(input: HookStrengthInput): ScoreResult {
  const engagementRate = computeEngagementRate(input.platform, input.likeCount, input.commentCount, input.viewCount);
  const hasHookPattern = HOOK_PATTERN.test(input.captionOrTitle);
  const thresholds = ENGAGEMENT_THRESHOLDS[input.platform];

  let score = engagementRateToScore(engagementRate, thresholds);
  const reasons: string[] = [];

  if (engagementRate >= thresholds.strong) {
    reasons.push('Your engagement rate (likes and comments compared to views) is strong for this platform, which usually means the opening kept people interested enough to react.');
  } else if (engagementRate >= thresholds.moderate) {
    reasons.push('Your engagement rate is around the typical average for this platform, suggesting the opening held some but not most viewers.');
  } else {
    reasons.push('Your engagement rate is below the typical average for this platform, which often means viewers scrolled or clicked away before the hook landed.');
  }

  if (hasHookPattern) {
    score += 20;
    reasons.push('Your title or caption uses a curiosity pattern (a question, a number, or a "how/why") — the first few seconds are when most viewers decide whether to keep watching, and a curiosity pattern gives them a reason to stay.');
  } else {
    reasons.push('Your title or caption does not use an obvious curiosity pattern (a question, a number, or a "how/why"), which can make the first few seconds less compelling — most viewers decide whether to keep watching almost immediately.');
  }

  if (input.platform === 'tiktok' && input.shareCount !== undefined && input.saveCount !== undefined) {
    const likes = Math.max(input.likeCount, 1);
    const distributionRatio = (input.shareCount + input.saveCount) / likes;
    if (distributionRatio >= DISTRIBUTION_BONUS_RATIO) {
      score += DISTRIBUTION_BONUS_POINTS;
      reasons.push('Your shares and saves are disproportionately high relative to your likes — TikTok now weighs these as stronger distribution signals than likes, so this is a good sign for reach even if the raw like count looks modest.');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, label: labelForScore(score), reasons };
}
