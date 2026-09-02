import { describe, it, expect } from 'vitest';
import { computeCadence, computeFormatMix, computeAverageEngagementRate } from '@/lib/strategy/aggregate';
import type { ChannelPost } from '@/lib/strategy/types';

function makePost(overrides: Partial<ChannelPost> = {}): ChannelPost {
  return {
    captionOrTitle: 'A post',
    publishedAt: '2026-08-11T10:00:00Z',
    durationSeconds: 30,
    viewCount: 1000,
    likeCount: 50,
    commentCount: 5,
    ...overrides,
  };
}

describe('computeCadence', () => {
  it('returns all zeros and a null day for an empty post list', () => {
    expect(computeCadence([])).toEqual({ postCount: 0, spanDays: 0, postsPerWeek: 0, mostCommonDayOfWeek: null });
  });

  it('falls back to postCount for postsPerWeek when the span is under a day', () => {
    const result = computeCadence([makePost({ publishedAt: '2026-08-11T10:00:00Z' })]);
    expect(result.spanDays).toBe(0);
    expect(result.postsPerWeek).toBe(1);
  });

  it('computes postsPerWeek from the span between the oldest and newest post', () => {
    // 3 posts spanning exactly 14 days (2 weeks) -> 3 / 14 * 7 = 1.5/week
    const posts = [
      makePost({ publishedAt: '2026-08-15T00:00:00Z' }),
      makePost({ publishedAt: '2026-08-08T00:00:00Z' }),
      makePost({ publishedAt: '2026-08-01T00:00:00Z' }),
    ];
    const result = computeCadence(posts);
    expect(result.spanDays).toBe(14);
    expect(result.postsPerWeek).toBe(1.5);
  });

  it('finds the most common day of the week', () => {
    // 2026-08-11 is a Tuesday; 2026-08-04 and 2026-07-28 are also Tuesdays.
    // 2026-08-06 is a Thursday (single occurrence).
    const posts = [
      makePost({ publishedAt: '2026-08-11T10:00:00Z' }),
      makePost({ publishedAt: '2026-08-06T10:00:00Z' }),
      makePost({ publishedAt: '2026-08-04T10:00:00Z' }),
      makePost({ publishedAt: '2026-07-28T10:00:00Z' }),
    ];
    expect(computeCadence(posts).mostCommonDayOfWeek).toBe('Tuesday');
  });

  it('breaks a day-of-week tie in favor of the most recent post (fetcher order is most-recent-first)', () => {
    // 2026-08-12 is a Wednesday, 2026-08-11 is a Tuesday -- one post each, tied.
    const posts = [makePost({ publishedAt: '2026-08-12T10:00:00Z' }), makePost({ publishedAt: '2026-08-11T10:00:00Z' })];
    expect(computeCadence(posts).mostCommonDayOfWeek).toBe('Wednesday');
  });
});

describe('computeFormatMix', () => {
  it('returns all zeros for an empty post list', () => {
    expect(computeFormatMix([])).toEqual({ averageDurationSeconds: 0, shortPct: 0, mediumPct: 0, longPct: 0 });
  });

  it('buckets posts into short/medium/long and computes the average duration', () => {
    const posts = [15, 45, 90, 300, 600].map((durationSeconds) => makePost({ durationSeconds }));
    const result = computeFormatMix(posts);
    expect(result.averageDurationSeconds).toBe(210);
    expect(result.shortPct).toBe(40);
    expect(result.mediumPct).toBe(20);
    expect(result.longPct).toBe(40);
  });

  it('treats exactly 60s as short and exactly 240s as medium (inclusive boundaries)', () => {
    const posts = [makePost({ durationSeconds: 60 }), makePost({ durationSeconds: 240 })];
    const result = computeFormatMix(posts);
    expect(result.shortPct).toBe(50);
    expect(result.mediumPct).toBe(50);
    expect(result.longPct).toBe(0);
  });
});

describe('computeAverageEngagementRate', () => {
  it('returns 0 for an empty post list', () => {
    expect(computeAverageEngagementRate('youtube', [])).toBe(0);
  });

  it('averages the per-post engagement rate across all posts', () => {
    const posts = [
      makePost({ likeCount: 100, commentCount: 0, viewCount: 1000 }), // 0.1
      makePost({ likeCount: 0, commentCount: 0, viewCount: 1000 }), // 0
    ];
    expect(computeAverageEngagementRate('youtube', posts)).toBe(0.05);
  });

  it('applies the TikTok comment weighting via the shared computeEngagementRate formula', () => {
    const posts = [makePost({ likeCount: 0, commentCount: 100, viewCount: 1000 })];
    // TikTok weights comments 2x: (0 + 100*2) / 1000 = 0.2
    expect(computeAverageEngagementRate('tiktok', posts)).toBe(0.2);
  });
});
