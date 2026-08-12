import { describe, it, expect } from 'vitest';
import { combineScores } from '@/lib/diagnostic/score';
import type { ScoreResult } from '@/lib/diagnostic/types';

function makeScore(score: number): ScoreResult {
  return { score, label: score >= 70 ? 'strong' : score >= 40 ? 'moderate' : 'weak', reasons: ['reason'] };
}

describe('combineScores', () => {
  it('computes a weighted overall score', () => {
    const result = combineScores({
      hookStrength: makeScore(80),
      retentionRisk: makeScore(80),
      timing: makeScore(80),
      formatFit: makeScore(80),
    });
    expect(result.overallScore).toBe(80);
  });

  it('weighs hook strength and retention risk more heavily than timing and format fit', () => {
    const highHookLowOthers = combineScores({
      hookStrength: makeScore(100),
      retentionRisk: makeScore(100),
      timing: makeScore(0),
      formatFit: makeScore(0),
    });
    const lowHookHighOthers = combineScores({
      hookStrength: makeScore(0),
      retentionRisk: makeScore(0),
      timing: makeScore(100),
      formatFit: makeScore(100),
    });
    expect(highHookLowOthers.overallScore).toBeGreaterThan(lowHookHighOthers.overallScore);
  });

  it('preserves the individual dimension scores on the combined result', () => {
    const result = combineScores({
      hookStrength: makeScore(60),
      retentionRisk: makeScore(60),
      timing: makeScore(60),
      formatFit: makeScore(60),
    });
    expect(result.hookStrength.score).toBe(60);
  });
});
