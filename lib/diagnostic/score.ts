import type { ScoreResult } from './types';

export interface CombinedScoreInput {
  hookStrength: ScoreResult;
  retentionRisk: ScoreResult;
  timing: ScoreResult;
  formatFit: ScoreResult;
  reach: ScoreResult | null;
}

export interface CombinedScore extends CombinedScoreInput {
  overallScore: number;
}

const WEIGHTS_WITH_REACH = { hookStrength: 0.23, retentionRisk: 0.23, reach: 0.23, timing: 0.155, formatFit: 0.155 };
// Dead key: only present so both weight objects share a shape for TS narrowing above; never applied — the reach term in the sum is separately guarded.
const WEIGHTS_WITHOUT_REACH = { hookStrength: 0.3, retentionRisk: 0.3, timing: 0.2, formatFit: 0.2, reach: 0 };

export function combineScores(input: CombinedScoreInput): CombinedScore {
  const weights = input.reach ? WEIGHTS_WITH_REACH : WEIGHTS_WITHOUT_REACH;
  const overallScore = Math.round(
    input.hookStrength.score * weights.hookStrength +
      input.retentionRisk.score * weights.retentionRisk +
      input.timing.score * weights.timing +
      input.formatFit.score * weights.formatFit +
      (input.reach ? input.reach.score * weights.reach : 0)
  );

  return { ...input, overallScore };
}
