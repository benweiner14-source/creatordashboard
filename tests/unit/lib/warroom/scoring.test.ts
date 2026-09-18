import { describe, it, expect } from 'vitest';
import { classifySeverity } from '@/lib/warroom/scoring';
import type { DiscoveredPost } from '@/lib/warroom/types';

const NOW = new Date('2026-09-15T12:00:00Z');

function post(overrides: Partial<DiscoveredPost> = {}): DiscoveredPost {
  return {
    platform: 'tiktok',
    externalPostId: 'p1',
    url: 'https://example.com/p1',
    captionOrTitle: 'A post',
    viewCount: 0,
    engagementCount: 0,
    publishedAt: '2026-09-15T11:00:00Z', // 1 hour before NOW
    ...overrides,
  };
}

describe('classifySeverity — TikTok', () => {
  it('classifies already_viral by view count regardless of the tier-specific age windows', () => {
    // 40 hours old -- well past the going_viral/heating_up windows (180min/240min),
    // but still inside the universal 48h cutoff, so already_viral's lack of an
    // extra age condition is what's being tested here, not the 48h cutoff itself.
    expect(classifySeverity(post({ viewCount: 1_000_000, publishedAt: '2026-09-13T20:00:00Z' }), NOW)).toBe('already_viral');
  });

  it('classifies going_viral by view count within the 180min window', () => {
    expect(classifySeverity(post({ viewCount: 300_000, publishedAt: '2026-09-15T10:00:00Z' }), NOW)).toBe('going_viral');
  });

  it('does not classify going_viral once the 180min window has passed', () => {
    expect(classifySeverity(post({ viewCount: 300_000, publishedAt: '2026-09-15T08:00:00Z' }), NOW)).not.toBe('going_viral');
  });

  it('classifies heating_up by engagement within the 240min window', () => {
    expect(classifySeverity(post({ engagementCount: 2_000, publishedAt: '2026-09-15T09:00:00Z' }), NOW)).toBe('heating_up');
  });

  it('returns null for a post below every threshold', () => {
    expect(classifySeverity(post({ viewCount: 100, engagementCount: 10 }), NOW)).toBeNull();
  });
});

describe('classifySeverity — Instagram', () => {
  it('classifies already_viral by engagement regardless of the tier-specific age windows', () => {
    // 40 hours old -- past going_viral/heating_up's own windows (120min/180min),
    // still inside the universal 48h cutoff.
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 15_000, publishedAt: '2026-09-13T20:00:00Z' }), NOW)).toBe(
      'already_viral'
    );
  });

  it('classifies going_viral by engagement within the 120min window', () => {
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 6_000, publishedAt: '2026-09-15T11:00:00Z' }), NOW)).toBe(
      'going_viral'
    );
  });

  it('classifies heating_up by engagement within the 180min window', () => {
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 2_500, publishedAt: '2026-09-15T09:30:00Z' }), NOW)).toBe(
      'heating_up'
    );
  });
});

describe('classifySeverity — YouTube', () => {
  it('classifies already_viral by total views regardless of viewsPerHour', () => {
    // 47 hours old (just inside the 48h cutoff): 200,000 views / 47h ≈ 4255
    // views/hour, which is BELOW the 5000 viewsPerHour threshold -- so this
    // isolates the "views >= 200,000" branch of already_viral, proving it
    // triggers independent of viewsPerHour, without also tripping the 48h cutoff.
    expect(
      classifySeverity(post({ platform: 'youtube', viewCount: 200_000, publishedAt: '2026-09-13T13:00:00Z' }), NOW)
    ).toBe('already_viral');
  });

  it('classifies going_viral by views-per-hour within 12h', () => {
    // 2 hours old, 4400 views -> 2200 views/hour
    expect(classifySeverity(post({ platform: 'youtube', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }), NOW)).toBe(
      'going_viral'
    );
  });

  it('classifies heating_up by views-per-hour within 24h', () => {
    // 10 hours old, 6000 views -> 600 views/hour
    expect(classifySeverity(post({ platform: 'youtube', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }), NOW)).toBe(
      'heating_up'
    );
  });
});

describe('classifySeverity — TikTok big account tier', () => {
  it('classifies going_viral by the looser view threshold within the 120min window', () => {
    // 200,000 views would not reach going_viral on the standard tier (needs 300,000)
    expect(
      classifySeverity(post({ isBigAccount: true, viewCount: 200_000, publishedAt: '2026-09-15T10:30:00Z' }), NOW)
    ).toBe('going_viral');
  });

  it('does not classify going_viral once the 120min window has passed', () => {
    expect(
      classifySeverity(post({ isBigAccount: true, viewCount: 200_000, publishedAt: '2026-09-15T09:00:00Z' }), NOW)
    ).not.toBe('going_viral');
  });

  it('classifies heating_up by the looser view threshold within the 240min window', () => {
    expect(
      classifySeverity(post({ isBigAccount: true, viewCount: 75_000, publishedAt: '2026-09-15T09:00:00Z' }), NOW)
    ).toBe('heating_up');
  });

  it('never classifies already_viral — the reference tier has no already_viral branch for big TikTok accounts', () => {
    expect(
      classifySeverity(post({ isBigAccount: true, viewCount: 50_000_000, engagementCount: 50_000_000, publishedAt: '2026-09-15T11:59:00Z' }), NOW)
    ).toBe('going_viral');
  });

  it('returns null for a big-account post below every threshold', () => {
    expect(classifySeverity(post({ isBigAccount: true, viewCount: 100, engagementCount: 10 }), NOW)).toBeNull();
  });
});

describe('classifySeverity — Instagram big account tier', () => {
  it('classifies already_viral by the looser view threshold within the 24h window', () => {
    // 500,000 views would not reach already_viral on the standard tier at all (IG standard has no view-based path)
    expect(
      classifySeverity(
        post({ platform: 'instagram', isBigAccount: true, viewCount: 500_000, publishedAt: '2026-09-14T13:00:00Z' }),
        NOW
      )
    ).toBe('already_viral');
  });

  it('does not classify already_viral once the 24h window has passed', () => {
    expect(
      classifySeverity(
        post({ platform: 'instagram', isBigAccount: true, viewCount: 500_000, publishedAt: '2026-09-13T11:00:00Z' }),
        NOW
      )
    ).not.toBe('already_viral');
  });

  it('classifies going_viral by the looser view threshold within the 120min window', () => {
    expect(
      classifySeverity(
        post({ platform: 'instagram', isBigAccount: true, viewCount: 200_000, publishedAt: '2026-09-15T10:30:00Z' }),
        NOW
      )
    ).toBe('going_viral');
  });

  it('classifies heating_up by the looser view threshold within the 240min window', () => {
    expect(
      classifySeverity(
        post({ platform: 'instagram', isBigAccount: true, viewCount: 50_000, publishedAt: '2026-09-15T09:00:00Z' }),
        NOW
      )
    ).toBe('heating_up');
  });

  it('returns null for a big-account post below every threshold', () => {
    expect(
      classifySeverity(post({ platform: 'instagram', isBigAccount: true, viewCount: 100, engagementCount: 10 }), NOW)
    ).toBeNull();
  });
});

describe('classifySeverity — global age cutoff', () => {
  it('returns null for a post older than 48 hours even at already_viral magnitude', () => {
    expect(
      classifySeverity(post({ platform: 'instagram', engagementCount: 999_999, publishedAt: '2026-09-10T00:00:00Z' }), NOW)
    ).toBeNull();
  });
});
