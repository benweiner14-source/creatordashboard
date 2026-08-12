import { labelForScore, type ScoreResult } from './types';

export interface RetentionRiskInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

const IDEAL_DURATION_SECONDS: Record<RetentionRiskInput['platform'], number> = {
  tiktok: 30,
  instagram: 30,
  youtube: 480,
};

export function scoreRetentionRisk(input: RetentionRiskInput): ScoreResult {
  const ideal = IDEAL_DURATION_SECONDS[input.platform];
  const durationRatio = input.durationSeconds / ideal;
  const durationPenalty = Math.min(Math.abs(1 - durationRatio) * 40, 40);

  const views = Math.max(input.viewCount, 1);
  const engagementRate = (input.likeCount + input.commentCount) / views;
  const engagementScore = Math.min(engagementRate * 1000, 60);

  const score = Math.max(0, Math.min(100, Math.round(60 - durationPenalty + engagementScore)));

  const reasons: string[] = [];
  if (durationRatio > 1.5) {
    reasons.push(`Your video runs longer than what tends to hold attention on ${input.platform} for this format, which raises the risk viewers drop off before the end.`);
  } else if (durationRatio < 0.5) {
    reasons.push(`Your video is much shorter than the typical length that performs well on ${input.platform}, which can leave your message unfinished for viewers.`);
  } else {
    reasons.push(`Your video's length is close to what tends to hold attention on ${input.platform}, which lowers the risk of viewers dropping off early.`);
  }

  if (engagementRate >= 0.05) {
    reasons.push('Strong engagement (likes and comments relative to views) usually correlates with people watching further into the video.');
  } else {
    reasons.push('Lower engagement (likes and comments relative to views) often correlates with viewers not watching far enough to react.');
  }

  return { score, label: labelForScore(score), reasons };
}
