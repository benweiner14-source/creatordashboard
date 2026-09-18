import { describe, it, expect } from 'vitest';
import { scoreReach } from '@/lib/diagnostic/reach';

describe('scoreReach', () => {
  describe('legacy behavioral checks (recalibrated for smooth anchor interpolation)', () => {
    it('scores 100K views on 1M followers (10% reach) as 34, weak', () => {
      // Previously 44/moderate under the old flat 1M-10M tier. 1,000,000
      // followers now sits exactly on the interior anchor shared by the
      // 100K-1M and 1M-10M calibration points, which uses the stricter
      // (100K-1M) boundary so the curve stays continuous down to 999,999
      // followers -- see "smooth interpolation between anchors" below.
      const result = scoreReach({ viewCount: 100_000, followerCount: 1_000_000 });
      expect(result.score).toBe(34);
      expect(result.label).toBe('weak');
    });

    it('scores 2M views on 1M followers (200% reach) as 72, strong', () => {
      // Previously 90/strong under the old flat 1M-10M tier; same anchor
      // note as above. Still comfortably strong, just a lower number.
      const result = scoreReach({ viewCount: 2_000_000, followerCount: 1_000_000 });
      expect(result.score).toBe(72);
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

  describe('reasons copy is tier-relative, not an absolute ratio claim', () => {
    it('does not claim a specific multiple for a moderate score at the top of a tier range (80x reach, <10K anchor)', () => {
      // 80x reach is well inside the <10K anchor's moderate band (2.372x-189.557x),
      // but far from "roughly in line" with the follower count.
      const followerCount = 5_000;
      const result = scoreReach({ viewCount: 80 * followerCount, followerCount });
      expect(result.label).toBe('moderate');
      expect(result.reasons[0]).toContain('typical range for an account your size');
      expect(result.reasons[0]).not.toMatch(/in line with your follower count/);
    });

    it('does not claim a specific multiple for a strong score under 1x reach (near the 1M-10M anchor)', () => {
      // 0.6x reach at 9,999,999 followers is just inside the flat tail beyond
      // the last anchor (moderate/strong boundary 0.555x there), but it is
      // less than the follower count, not "several times" it.
      const followerCount = 9_999_999;
      const result = scoreReach({ viewCount: Math.round(0.6 * followerCount), followerCount });
      expect(result.label).toBe('strong');
      expect(result.reasons[0]).toContain("well above what's typical for an account your size");
      expect(result.reasons[0]).not.toMatch(/several times/);
    });

    it('weak reasons copy is also tier-relative', () => {
      const result = scoreReach({ viewCount: 34_000, followerCount: 5_400_000 });
      expect(result.label).toBe('weak');
      expect(result.reasons[0]).toContain("below what's typical for an account your size");
    });
  });

  describe('exact anchor boundaries', () => {
    it('scores exactly 40 and 70 at the 10,000-follower anchor (2.372x / 189.557x)', () => {
      const followerCount = 10_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(2.372 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(189.557 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atWeakModerate.label).toBe('moderate');
      expect(atModerateStrong.score).toBe(70);
      expect(atModerateStrong.label).toBe('strong');
    });

    it('scores exactly 40 and 70 at the 100,000-follower anchor (1.023x / 15.445x)', () => {
      const followerCount = 100_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(1.023 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(15.445 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
    });

    it('scores exactly 40 and 70 at the 1,000,000-follower anchor (0.163x / 1.770x)', () => {
      const followerCount = 1_000_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(0.163 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(1.770 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
    });

    it('scores exactly 40 and 70 at the 10,000,000-follower anchor (0.078x / 0.555x)', () => {
      const followerCount = 10_000_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
    });
  });

  describe('smooth interpolation between anchors (the fix this suite is for)', () => {
    it('no longer swings the score by double digits when a follower count crosses an anchor by 1', () => {
      // Before this fix, crossing 100,000 followers by a single follower
      // (at a fixed view count) could move the score by +23 points. Now,
      // gaining or losing 1 follower right at any anchor changes nothing.
      for (const anchor of [10_000, 100_000, 1_000_000, 10_000_000]) {
        const viewCount = anchor * 5;
        const below = scoreReach({ viewCount, followerCount: anchor - 1 });
        const at = scoreReach({ viewCount, followerCount: anchor });
        const above = scoreReach({ viewCount, followerCount: anchor + 1 });
        expect(below.score).toBe(at.score);
        expect(at.score).toBe(above.score);
      }
    });

    it('two similarly-sized creators near the old 100K cliff now score within a few points of each other', () => {
      // Both posts have the same 3x reach ratio. Under the old flat tiers,
      // 60,000 followers scored 52 (moderate, 10K-100K tier's boundaries)
      // while 100,001 followers scored 77 (strong, 100K-1M tier's much
      // looser boundaries) -- a 25-point cliff for two accounts 40,000
      // followers apart. Interpolation collapses that gap.
      const smaller = scoreReach({ viewCount: 3 * 60_000, followerCount: 60_000 });
      const larger = scoreReach({ viewCount: 3 * 100_001, followerCount: 100_001 });
      expect(smaller.score).toBe(49);
      expect(larger.score).toBe(52);
      expect(Math.abs(larger.score - smaller.score)).toBeLessThanOrEqual(5);
      expect(smaller.label).toBe('moderate');
      expect(larger.label).toBe('moderate');
    });

    it('interpolates a follower count between two anchors strictly between their calibrated ratios', () => {
      // 60,000 followers sits between the 10,000 anchor (moderate/strong at
      // 189.557x) and the 100,000 anchor (moderate/strong at 15.445x). Its
      // own boundary should land strictly between those two, not equal
      // either one and not jump outside the range.
      const followerCount = 60_000;
      const justBelowNearAnchor = scoreReach({ viewCount: Math.round(15.445 * followerCount), followerCount });
      const justAboveFarAnchor = scoreReach({ viewCount: Math.round(189.557 * followerCount), followerCount });
      // The 100,000 anchor's own ratio (15.445x) is not yet enough to be
      // "strong" at 60,000 followers -- its own interpolated bar is higher.
      expect(justBelowNearAnchor.label).not.toBe('strong');
      // The 10,000 anchor's own ratio (189.557x) is already "strong" at
      // 60,000 followers -- its own interpolated bar is lower.
      expect(justAboveFarAnchor.label).toBe('strong');
    });
  });

  describe('flat tails preserved outside the anchor range', () => {
    it('applies the first anchor\'s value flat below 10,000 followers', () => {
      const result = scoreReach({ viewCount: 9_999 * 5, followerCount: 9_999 });
      expect(result.score).toBe(45);
    });

    it('applies the last anchor\'s value flat above 10,000,000 followers (the old 10M+ placeholder)', () => {
      const followerCount = 50_000_000;
      const atWeakModerate = scoreReach({ viewCount: Math.round(0.078 * followerCount), followerCount });
      const atModerateStrong = scoreReach({ viewCount: Math.round(0.555 * followerCount), followerCount });
      expect(atWeakModerate.score).toBe(40);
      expect(atModerateStrong.score).toBe(70);
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
