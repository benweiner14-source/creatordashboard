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
      reach: null,
    });
    expect(result.overallScore).toBe(80);
  });

  it('weighs hook strength and retention risk more heavily than timing and format fit', () => {
    const highHookLowOthers = combineScores({
      hookStrength: makeScore(100),
      retentionRisk: makeScore(100),
      timing: makeScore(0),
      formatFit: makeScore(0),
      reach: null,
    });
    const lowHookHighOthers = combineScores({
      hookStrength: makeScore(0),
      retentionRisk: makeScore(0),
      timing: makeScore(100),
      formatFit: makeScore(100),
      reach: null,
    });
    expect(highHookLowOthers.overallScore).toBeGreaterThan(lowHookHighOthers.overallScore);
  });

  it('preserves the individual dimension scores on the combined result', () => {
    const result = combineScores({
      hookStrength: makeScore(60),
      retentionRisk: makeScore(60),
      timing: makeScore(60),
      formatFit: makeScore(60),
      reach: null,
    });
    expect(result.hookStrength.score).toBe(60);
  });

  it('uses the original 30/30/20/20 weights when reach is null', () => {
    const withoutReach = combineScores({
      hookStrength: makeScore(100),
      retentionRisk: makeScore(100),
      timing: makeScore(0),
      formatFit: makeScore(0),
      reach: null,
    });
    // 100*0.3 + 100*0.3 + 0*0.2 + 0*0.2 = 60
    expect(withoutReach.overallScore).toBe(60);
  });

  it('uses the 23/23/23/15.5/15.5 weights when reach is present', () => {
    const withReach = combineScores({
      hookStrength: makeScore(100),
      retentionRisk: makeScore(100),
      timing: makeScore(0),
      formatFit: makeScore(0),
      reach: makeScore(100),
    });
    // 100*0.23 + 100*0.23 + 100*0.23 = 69
    expect(withReach.overallScore).toBe(69);
  });

  it('preserves a null reach on the combined result', () => {
    const result = combineScores({
      hookStrength: makeScore(60),
      retentionRisk: makeScore(60),
      timing: makeScore(60),
      formatFit: makeScore(60),
      reach: null,
    });
    expect(result.reach).toBeNull();
  });
});
