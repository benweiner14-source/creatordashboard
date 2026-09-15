import { describe, it, expect } from 'vitest';
import { filterPostsToMonth, aggregateRecap } from '@/lib/recap/aggregate';
import type { AggregatablePost } from '@/lib/recap/types';

const NOW = new Date('2026-08-31T00:00:00Z');

function post(overrides: Partial<AggregatablePost> = {}): AggregatablePost {
  return {
    platform: 'tiktok',
    captionOrTitle: 'A post',
    publishedAt: '2026-08-10T00:00:00Z',
    viewCount: 100,
    likeCount: 10,
    commentCount: 1,
    permalink: 'https://tiktok.com/@x/video/1',
    ...overrides,
  };
}

describe('filterPostsToMonth', () => {
  it('keeps posts published within the target month', () => {
    const posts = [post({ publishedAt: '2026-08-01T00:00:00Z' }), post({ publishedAt: '2026-08-31T23:59:00Z' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(2);
  });

  it('excludes posts published outside the target month', () => {
    const posts = [post({ publishedAt: '2026-07-31T23:59:00Z' }), post({ publishedAt: '2026-09-01T00:00:00Z' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(0);
  });

  it('excludes posts with an unparseable or blank date rather than including them by default', () => {
    const posts = [post({ publishedAt: '' }), post({ publishedAt: 'not-a-date' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(0);
  });
});

describe('aggregateRecap', () => {
  it('sums totals across platforms and picks the single highest-view post as the overall top post', () => {
    const result = aggregateRecap({
      youtube: [post({ platform: 'youtube', viewCount: 500, likeCount: 40, commentCount: 5, captionOrTitle: 'YT video' })],
      tiktok: [
        post({ platform: 'tiktok', viewCount: 900, likeCount: 80, commentCount: 10, captionOrTitle: 'TikTok hit' }),
        post({ platform: 'tiktok', viewCount: 100, likeCount: 5, commentCount: 1 }),
      ],
    });

    expect(result.totals).toEqual({ views: 1500, likes: 125, comments: 16, postCount: 3 });
    expect(result.platformData.youtube).toEqual({ views: 500, likes: 40, comments: 5, postCount: 1 });
    expect(result.platformData.tiktok).toEqual({ views: 1000, likes: 85, comments: 11, postCount: 2 });
    expect(result.topPost).toEqual({
      platform: 'tiktok',
      captionOrTitle: 'TikTok hit',
      viewCount: 900,
      permalink: 'https://tiktok.com/@x/video/1',
    });
  });

  it('picks the post with the higher views-per-hour, not the higher raw view count', () => {
    // "Old but huge" racked up more total views, but it's been live for
    // 30 days -- 20/hr. "New and rising" is only 10 hours old at 90/hr.
    const result = aggregateRecap(
      {
        youtube: [
          post({
            platform: 'youtube',
            captionOrTitle: 'Old but huge',
            viewCount: 14400,
            publishedAt: '2026-08-01T00:00:00Z', // 30 days before NOW
          }),
          post({
            platform: 'youtube',
            captionOrTitle: 'New and rising',
            viewCount: 900,
            publishedAt: '2026-08-30T14:00:00Z', // 10 hours before NOW
          }),
        ],
      },
      NOW
    );

    expect(result.topPost?.captionOrTitle).toBe('New and rising');
  });

  it('drops a platform entirely when it has no posts, rather than including a zeroed entry', () => {
    const result = aggregateRecap({ youtube: [post({ platform: 'youtube' })], tiktok: [] });
    expect(result.platformData.tiktok).toBeUndefined();
  });

  it('returns a null top post and zeroed totals when every platform is empty', () => {
    const result = aggregateRecap({});
    expect(result.topPost).toBeNull();
    expect(result.totals).toEqual({ views: 0, likes: 0, comments: 0, postCount: 0 });
  });
});
