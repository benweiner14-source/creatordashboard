import { labelForScore, type ScoreResult } from './types';

export interface HookStrengthInput {
  captionOrTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

const HOOK_PATTERN = /(\?|\bhow\b|\bwhy\b|\bwait\b|\bstop\b|\d+)/i;

export function scoreHookStrength(input: HookStrengthInput): ScoreResult {
  const views = Math.max(input.viewCount, 1);
  const engagementRate = (input.likeCount + input.commentCount) / views;
  const hasHookPattern = HOOK_PATTERN.test(input.captionOrTitle);

  let score = Math.min(engagementRate * 1000, 70);
  const reasons: string[] = [];

  if (engagementRate >= 0.05) {
    reasons.push('Your engagement rate (likes and comments compared to views) is high, which usually means the opening kept people interested enough to react.');
  } else if (engagementRate >= 0.02) {
    reasons.push('Your engagement rate is moderate, suggesting the opening held some but not most viewers.');
  } else {
    reasons.push('Your engagement rate is low, which often means viewers scrolled or clicked away before the hook landed.');
  }

  if (hasHookPattern) {
    score += 20;
    reasons.push('Your title or caption uses a curiosity pattern (a question, a number, or a "how/why") that tends to earn a stronger hook.');
  } else {
    reasons.push('Your title or caption does not use an obvious curiosity pattern (a question, a number, or a "how/why"), which can make the first few seconds less compelling.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, label: labelForScore(score), reasons };
}
