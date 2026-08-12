import type { ScoreResult } from './types';

export interface CombinedScoreInput {
  hookStrength: ScoreResult;
  retentionRisk: ScoreResult;
  timing: ScoreResult;
  formatFit: ScoreResult;
}

export interface CombinedScore extends CombinedScoreInput {
  overallScore: number;
}

const WEIGHTS = {
  hookStrength: 0.3,
  retentionRisk: 0.3,
  timing: 0.2,
  formatFit: 0.2,
};

export function combineScores(input: CombinedScoreInput): CombinedScore {
  const overallScore = Math.round(
    input.hookStrength.score * WEIGHTS.hookStrength +
      input.retentionRisk.score * WEIGHTS.retentionRisk +
      input.timing.score * WEIGHTS.timing +
      input.formatFit.score * WEIGHTS.formatFit
  );

  return { ...input, overallScore };
}
