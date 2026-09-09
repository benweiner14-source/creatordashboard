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

  it('excludes posts with an unparseable publishedAt from postsPerWeek', () => {
    // 3 parseable posts spanning 14 days -> 1.5/week. The two junk timestamps
    // contribute nothing to the span, so they must not inflate the numerator.
    const posts = [
      makePost({ publishedAt: '2026-08-15T00:00:00Z' }),
      makePost({ publishedAt: 'not a date' }),
      makePost({ publishedAt: '2026-08-08T00:00:00Z' }),
      makePost({ publishedAt: '' }),
      makePost({ publishedAt: '2026-08-01T00:00:00Z' }),
    ];
    const result = computeCadence(posts);
    expect(result.spanDays).toBe(14);
    expect(result.postsPerWeek).toBe(1.5);
    expect(result.postCount).toBe(5);
  });

  it('excludes unparseable timestamps from the under-a-day postsPerWeek fallback too', () => {
    const posts = [makePost({ publishedAt: '2026-08-11T10:00:00Z' }), makePost({ publishedAt: 'not a date' })];
    expect(computeCadence(posts).postsPerWeek).toBe(1);
  });
});

describe('computeFormatMix', () => {
  it('returns all zeros for an empty post list', () => {
    expect(computeFormatMix([])).toEqual({
      averageDurationSeconds: 0,
      shortPct: 0,
      mediumPct: 0,
      longPct: 0,
      postsWithUnknownDuration: 0,
    });
  });

  it('buckets posts into short/medium/long and computes the average duration', () => {
    const posts = [15, 45, 90, 300, 600].map((durationSeconds) => makePost({ durationSeconds }));
    const result = computeFormatMix(posts);
    expect(result.averageDurationSeconds).toBe(210);
    expect(result.shortPct).toBe(40);
    expect(result.mediumPct).toBe(20);
    expect(result.longPct).toBe(40);
    expect(result.postsWithUnknownDuration).toBe(0);
  });

  it('treats exactly 60s as short and exactly 240s as medium (inclusive boundaries)', () => {
    const posts = [makePost({ durationSeconds: 60 }), makePost({ durationSeconds: 240 })];
    const result = computeFormatMix(posts);
    expect(result.shortPct).toBe(50);
    expect(result.mediumPct).toBe(50);
    expect(result.longPct).toBe(0);
  });

  it('excludes posts with an unknown duration from the buckets and the average', () => {
    // Instagram photos/carousels come back from the scraper with no duration.
    const posts = [
      makePost({ durationSeconds: 30 }),
      makePost({ durationSeconds: undefined }),
      makePost({ durationSeconds: undefined }),
      makePost({ durationSeconds: 300 }),
    ];
    const result = computeFormatMix(posts);
    // Average and percentages are computed against the 2 known durations only.
    expect(result.averageDurationSeconds).toBe(165);
    expect(result.shortPct).toBe(50);
    expect(result.mediumPct).toBe(0);
    expect(result.longPct).toBe(50);
    expect(result.postsWithUnknownDuration).toBe(2);
  });

  it('returns zero percentages when no post has a known duration', () => {
    const posts = [makePost({ durationSeconds: undefined }), makePost({ durationSeconds: undefined })];
    expect(computeFormatMix(posts)).toEqual({
      averageDurationSeconds: 0,
      shortPct: 0,
      mediumPct: 0,
      longPct: 0,
      postsWithUnknownDuration: 2,
    });
  });

  it('adjusts the largest rounding remainder so the three percentages sum to 100', () => {
    // 1 short / 1 medium / 1 long -> 33.33% each; naive rounding gives 99.
    const thirds = computeFormatMix([
      makePost({ durationSeconds: 30 }),
      makePost({ durationSeconds: 120 }),
      makePost({ durationSeconds: 600 }),
    ]);
    expect(thirds.shortPct + thirds.mediumPct + thirds.longPct).toBe(100);

    // 2 short / 2 medium / 2 long out of 7 (plus 1 more short) -> 42.9/28.6/28.6.
    const sevenths = computeFormatMix([
      ...[30, 30, 30].map((durationSeconds) => makePost({ durationSeconds })),
      ...[120, 120].map((durationSeconds) => makePost({ durationSeconds })),
      ...[600, 600].map((durationSeconds) => makePost({ durationSeconds })),
    ]);
    expect(sevenths.shortPct + sevenths.mediumPct + sevenths.longPct).toBe(100);
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
