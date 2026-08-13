import { describe, it, expect } from 'vitest';
import { isLikelyYouTubeShort } from '@/lib/diagnostic/types';

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
