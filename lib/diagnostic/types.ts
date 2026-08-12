export type ScoreLabel = 'weak' | 'moderate' | 'strong';

export interface ScoreResult {
  score: number;
  label: ScoreLabel;
  reasons: string[];
}

export function labelForScore(score: number): ScoreLabel {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}
