import { describe, it, expect } from 'vitest';
import { scoreHookStrength } from '@/lib/diagnostic/hook-strength';

describe('scoreHookStrength', () => {
  it('scores high engagement with a curiosity-pattern caption as strong', () => {
    const result = scoreHookStrength({
      platform: 'tiktok',
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
      platform: 'tiktok',
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
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 100,
      likeCount: 1,
      commentCount: 0,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('reads a 2.6% engagement rate as moderate on Instagram (Reels benchmark average)', () => {
    const result = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'New post',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 60,
    });
    expect(result.label).toBe('moderate');
  });

  it('scores the same 4% engagement rate differently depending on platform', () => {
    const tiktokResult = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 300,
      commentCount: 100,
    });
    const instagramResult = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 300,
      commentCount: 100,
    });
    expect(tiktokResult.label).toBe('moderate');
    expect(instagramResult.label).toBe('strong');
  });
});
