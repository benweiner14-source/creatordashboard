import { describe, it, expect } from 'vitest';
import { describeReachRelativeToHistory } from '@/lib/diagnostic/reach-history';

describe('describeReachRelativeToHistory', () => {
  it('returns null when there are fewer than 3 past scores', () => {
    expect(describeReachRelativeToHistory(80, [])).toBeNull();
    expect(describeReachRelativeToHistory(80, [50])).toBeNull();
    expect(describeReachRelativeToHistory(80, [50, 60])).toBeNull();
  });

  it('declares a new best when the current score beats every past score', () => {
    expect(describeReachRelativeToHistory(90, [40, 50, 60])).toBe(
      'This is your best Reach score out of your last 3 diagnosed posts.'
    );
  });

  it('does not declare a new best when the current score ties the past maximum', () => {
    // Ties go to the "above typical" branch, not "best" -- "best" is reserved
    // for a score that is strictly, unambiguously a new high.
    const result = describeReachRelativeToHistory(60, [40, 50, 60]);
    expect(result).not.toContain('best');
  });

  it('reports above typical when the current score beats the median but not the max', () => {
    expect(describeReachRelativeToHistory(55, [40, 50, 100])).toBe(
      "Your reach here is above what's typical for your own recent posts."
    );
  });

  it('reports below typical when the current score is under the median', () => {
    expect(describeReachRelativeToHistory(30, [40, 50, 100])).toBe(
      "Your reach here is below what's typical for your own recent posts."
    );
  });

  it('reports about typical when the current score equals the median', () => {
    expect(describeReachRelativeToHistory(50, [40, 50, 100])).toBe(
      'Your reach here is about typical for your own recent posts.'
    );
  });

  it('computes the median correctly for an even-length history', () => {
    // sorted [40, 50, 60, 100] -> median = (50+60)/2 = 55
    expect(describeReachRelativeToHistory(55, [100, 40, 60, 50])).toBe(
      'Your reach here is about typical for your own recent posts.'
    );
  });

  it('includes the actual history length in the "best" message, not a fixed window size', () => {
    const pastScores = [10, 20, 30, 40, 50, 60, 70];
    expect(describeReachRelativeToHistory(100, pastScores)).toBe(
      'This is your best Reach score out of your last 7 diagnosed posts.'
    );
  });
});
