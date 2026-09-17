import { describe, it, expect } from 'vitest';
import { scoreReach } from '@/lib/diagnostic/reach';

describe('scoreReach', () => {
  it('scores exactly the weak/moderate boundary (10% reach) as 40', () => {
    const result = scoreReach({ viewCount: 100_000, followerCount: 1_000_000 });
    expect(result.score).toBe(40);
    expect(result.label).toBe('moderate');
  });

  it('scores exactly the moderate/strong boundary (200% reach) as 70', () => {
    const result = scoreReach({ viewCount: 2_000_000, followerCount: 1_000_000 });
    expect(result.score).toBe(70);
    expect(result.label).toBe('strong');
  });

  it('clamps very low reach to 0', () => {
    const result = scoreReach({ viewCount: 1, followerCount: 5_400_000 });
    expect(result.score).toBe(0);
    expect(result.label).toBe('weak');
  });

  it('clamps very high reach to 100', () => {
    const result = scoreReach({ viewCount: 34_800_000, followerCount: 64_700 });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('reproduces the real NBA 2K case: 34K views on 5.4M followers scores weak', () => {
    const result = scoreReach({ viewCount: 34_000, followerCount: 5_400_000 });
    expect(result.label).toBe('weak');
  });

  it('always returns at least one reason', () => {
    const result = scoreReach({ viewCount: 500_000, followerCount: 1_000_000 });
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
