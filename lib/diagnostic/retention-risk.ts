import { labelForScore, isLikelyYouTubeShort, type ScoreResult } from './types';

export interface RetentionRiskInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

// Ideal duration per platform. TikTok (30s) and long-form YouTube (480s /
// 8 min) are independently supported by sourced research: 30s clips get
// the highest TikTok engagement rate and sit inside the 21-34s
// max-completion range; YouTube "starts rewarding with higher suggested
// placement after minute 8." Instagram (20s) is a documented compromise —
// Reels between 7-15s get the highest retention (60-80%), but total watch
// time also matters, so a pure "shortest wins" number would be misleading.
// YouTube Shorts (30s) gets its own anchor, separate from long-form
// YouTube — Shorts are capped at 3 minutes (180s) and best-performing
// Shorts cluster at 30-60s, with many viral Shorts landing at 25-35s (the
// same range TikTok's anchor is drawn from). See
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const IDEAL_DURATION_SECONDS: Record<RetentionRiskInput['platform'], number> = {
  tiktok: 30,
  instagram: 20,
  youtube: 480,
};
const YOUTUBE_SHORTS_IDEAL_DURATION_SECONDS = 30;

// Engagement rate at which a platform's engagement contribution saturates.
// TikTok's bar is set high because ~7.5% is the *average* for gaming
// accounts under 100K followers (our target cohort), not exceptional.
// Instagram's is anchored near the average of Sprout Social's and
// Hootsuite's Reels-specific figures (2.35%/2.8% ≈ 2.6%). YouTube has no
// sourced engagement-rate benchmark (CTR needs impression data the public
// API doesn't expose) and keeps its original estimate.
const ENGAGEMENT_SATURATION: Record<RetentionRiskInput['platform'], number> = {
  tiktok: 0.08,
  instagram: 0.04,
  youtube: 0.05,
};

export function scoreRetentionRisk(input: RetentionRiskInput): ScoreResult {
  const isShort = isLikelyYouTubeShort(input.platform, input.durationSeconds);
  const ideal = isShort ? YOUTUBE_SHORTS_IDEAL_DURATION_SECONDS : IDEAL_DURATION_SECONDS[input.platform];
  const durationRatio = input.durationSeconds / ideal;
  const durationPenalty = Math.min(Math.abs(1 - durationRatio) * 40, 40);

  const views = Math.max(input.viewCount, 1);
  const engagementRate = (input.likeCount + input.commentCount) / views;
  const saturation = ENGAGEMENT_SATURATION[input.platform];
  const engagementScore = Math.min((engagementRate / saturation) * 60, 60);

  const score = Math.max(0, Math.min(100, Math.round(60 - durationPenalty + engagementScore)));

  const platformLabel = isShort ? 'YouTube Shorts' : input.platform;
  const reasons: string[] = [];
  if (durationRatio > 1.5) {
    reasons.push(`Your video runs longer than what tends to hold attention on ${platformLabel} for this format, which raises the risk viewers drop off before the end.`);
  } else if (durationRatio < 0.5) {
    reasons.push(`Your video is much shorter than the typical length that performs well on ${platformLabel}, which can leave your message unfinished for viewers.`);
  } else {
    reasons.push(`Your video's length is close to what tends to hold attention on ${platformLabel}, which lowers the risk of viewers dropping off early.`);
  }

  if (engagementRate >= saturation) {
    reasons.push('Strong engagement (likes and comments relative to views) usually correlates with people watching further into the video.');
  } else {
    reasons.push('Lower engagement (likes and comments relative to views) often correlates with viewers not watching far enough to react.');
  }

  return { score, label: labelForScore(score), reasons };
}
