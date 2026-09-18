import { describe, it, expect } from 'vitest';
import { scoreReach } from '@/lib/diagnostic/reach';

describe('scoreReach', () => {
  describe('legacy behavioral checks (recalibrated to per-tier boundaries)', () => {
    it('scores 100K views on 1M followers (10% reach) as 44 under the 1M-10M tier', () => {
      const result = scoreReach({ viewCount: 100_000, followerCount: 1_000_000 });
      expect(result.score).toBe(44);
      expect(result.label).toBe('moderate');
    });

    it('scores 2M views on 1M followers (200% reach) as 90 under the 1M-10M tier', () => {
      const result = scoreReach({ viewCount: 2_000_000, followerCount: 1_000_000 });
      expect(result.score).toBe(90);
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

  describe('per-tier boundaries', () => {
    it('scores exactly the <10K tier weak/moderate boundary (2.372x) as 40', () => {
      const followerCount = 9_999;
      const result = scoreReach({ viewCount: Math.round(2.372 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the <10K tier moderate/strong boundary (189.557x) as 70', () => {
      const followerCount = 9_999;
      const result = scoreReach({ viewCount: Math.round(189.557 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 10K-100K tier weak/moderate boundary (1.023x) as 40', () => {
      const followerCount = 99_999;
      const result = scoreReach({ viewCount: Math.round(1.023 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 10K-100K tier moderate/strong boundary (15.445x) as 70', () => {
      const followerCount = 99_999;
      const result = scoreReach({ viewCount: Math.round(15.445 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 100K-1M tier weak/moderate boundary (0.163x) as 40', () => {
      const followerCount = 999_999;
      const result = scoreReach({ viewCount: Math.round(0.163 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 100K-1M tier moderate/strong boundary (1.770x) as 70', () => {
      const followerCount = 999_999;
      const result = scoreReach({ viewCount: Math.round(1.770 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('scores exactly the 1M-10M tier weak/moderate boundary (0.078x) as 40', () => {
      const followerCount = 9_999_999;
      const result = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      expect(result.score).toBe(40);
      expect(result.label).toBe('moderate');
    });

    it('scores exactly the 1M-10M tier moderate/strong boundary (0.555x) as 70', () => {
      const followerCount = 9_999_999;
      const result = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(result.score).toBe(70);
      expect(result.label).toBe('strong');
    });

    it('10M+ inherits the 1M-10M tier boundaries', () => {
      const followerCount = 50_000_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
    });
  });

  describe('tier boundary edges', () => {
    it('applies the <10K tier to a follower count of exactly 9,999', () => {
      // At the same 5.0x ratio, the <10K tier's boundaries (2.372/189.557) score
      // this lower than the 10K-100K tier's boundaries (1.023/15.445) would.
      const result = scoreReach({ viewCount: 9_999 * 5, followerCount: 9_999 });
      expect(result.score).toBe(45);
    });

    it('applies the 10K-100K tier to a follower count of exactly 10,000', () => {
      const result = scoreReach({ viewCount: 10_000 * 5, followerCount: 10_000 });
      expect(result.score).toBe(58);
    });
  });

  describe('real-content calibration reproductions', () => {
    it('reproduces the @gamingclips513 gut-check example: 201.7K views on 3,962 followers scores 61 (moderate)', () => {
      const result = scoreReach({ viewCount: 201_700, followerCount: 3_962 });
      expect(result.score).toBe(61);
      expect(result.label).toBe('moderate');
    });

    it('reproduces the @king.gaming3483 gut-check example: 8,929 views on 4,444 followers scores 39 (weak)', () => {
      const result = scoreReach({ viewCount: 8_929, followerCount: 4_444 });
      expect(result.score).toBe(39);
      expect(result.label).toBe('weak');
    });
  });
});
