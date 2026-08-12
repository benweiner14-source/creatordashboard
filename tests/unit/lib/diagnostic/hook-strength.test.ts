// tests/unit/lib/diagnostic/hook-strength.test.ts
import { describe, it, expect } from 'vitest';
import { scoreHookStrength } from '@/lib/diagnostic/hook-strength';

describe('scoreHookStrength', () => {
  it('scores high engagement with a curiosity-pattern caption as strong', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'How I got 10k views in 3 days',
      viewCount: 10000,
      likeCount: 800,
      commentCount: 200,
    });
    expect(result.label).toBe('strong');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores low engagement with a plain caption as weak', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'My new video',
      viewCount: 10000,
      likeCount: 20,
      commentCount: 5,
    });
    expect(result.label).toBe('weak');
    expect(result.score).toBeLessThan(40);
  });

  it('always returns at least one reason explaining the score', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'Untitled',
      viewCount: 100,
      likeCount: 1,
      commentCount: 0,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
