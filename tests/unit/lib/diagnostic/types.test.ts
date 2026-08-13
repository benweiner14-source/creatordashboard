import { describe, it, expect } from 'vitest';
import { isLikelyYouTubeShort, computeEngagementRate } from '@/lib/diagnostic/types';

describe('isLikelyYouTubeShort', () => {
  it('treats a youtube video at or under 180s as Shorts-shaped', () => {
    expect(isLikelyYouTubeShort('youtube', 45)).toBe(true);
    expect(isLikelyYouTubeShort('youtube', 180)).toBe(true);
  });

  it('treats a youtube video over 180s as long-form', () => {
    expect(isLikelyYouTubeShort('youtube', 181)).toBe(false);
    expect(isLikelyYouTubeShort('youtube', 480)).toBe(false);
  });

  it('never treats tiktok or instagram as a youtube short, regardless of duration', () => {
    expect(isLikelyYouTubeShort('tiktok', 30)).toBe(false);
    expect(isLikelyYouTubeShort('instagram', 20)).toBe(false);
  });
});

describe('computeEngagementRate', () => {
  it('weights comments 2x on tiktok, so a comment-heavy post scores higher than a like-heavy post with the same total engagement', () => {
    const commentHeavy = computeEngagementRate('tiktok', 100, 200, 10000); // 300 total
    const likeHeavy = computeEngagementRate('tiktok', 200, 100, 10000); // 300 total, same sum
    expect(commentHeavy).toBeGreaterThan(likeHeavy);
    // (100 + 200*2) / 10000 = 0.05
    expect(commentHeavy).toBeCloseTo(0.05, 5);
    // (200 + 100*2) / 10000 = 0.04
    expect(likeHeavy).toBeCloseTo(0.04, 5);
  });

  it('does not weight comments on instagram or youtube — same total engagement scores identically regardless of split', () => {
    for (const platform of ['instagram', 'youtube'] as const) {
      const commentHeavy = computeEngagementRate(platform, 100, 200, 10000);
      const likeHeavy = computeEngagementRate(platform, 200, 100, 10000);
      expect(commentHeavy).toBe(likeHeavy);
      expect(commentHeavy).toBeCloseTo(0.03, 5);
    }
  });

  it('treats zero views as one view, avoiding division by zero', () => {
    expect(computeEngagementRate('tiktok', 5, 5, 0)).toBe(15); // (5 + 5*2) / 1
  });
});
