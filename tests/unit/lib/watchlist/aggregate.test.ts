import { describe, it, expect } from 'vitest';
import { buildSnapshotSummary, computeDeltas } from '@/lib/watchlist/aggregate';
import type { ChannelSnapshotInputPost } from '@/lib/watchlist/types';

const NOW = new Date('2026-09-10T12:00:00Z');

function makePost(overrides: Partial<ChannelSnapshotInputPost> = {}): ChannelSnapshotInputPost {
  return {
    captionOrTitle: 'A post',
    url: 'https://example.com/post',
    viewCount: 1000,
    publishedAt: '2026-09-10T02:00:00Z', // 10 hours before NOW
    ...overrides,
  };
}

describe('buildSnapshotSummary', () => {
  it('sorts an undateable post to the bottom instead of corrupting the ranking', () => {
    const summary = buildSnapshotSummary(
      {
        subscriberCount: null,
        totalViewCount: 0,
        videoCount: 2,
        posts: [
          makePost({ captionOrTitle: 'Undateable', viewCount: 999999, publishedAt: '' }),
          makePost({ captionOrTitle: 'Normal', viewCount: 100, publishedAt: '2026-09-10T02:00:00Z' }),
        ],
      },
      NOW
    );
    expect(summary.topPosts.map((p) => p.captionOrTitle)).toEqual(['Normal', 'Undateable']);
    expect(summary.topPosts[1].viewsPerHour).toBe(0);
  });

  it('ranks posts by views-per-hour descending and keeps only the top 5', () => {
    const posts = [
      makePost({ captionOrTitle: 'Slow', viewCount: 100, publishedAt: '2026-09-10T02:00:00Z' }), // 10/hr
      makePost({ captionOrTitle: 'Fast', viewCount: 900, publishedAt: '2026-09-10T11:00:00Z' }), // 900/hr
      makePost({ captionOrTitle: 'Mid A', viewCount: 200, publishedAt: '2026-09-10T10:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Mid B', viewCount: 300, publishedAt: '2026-09-10T09:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Mid C', viewCount: 400, publishedAt: '2026-09-10T08:00:00Z' }), // 100/hr
      makePost({ captionOrTitle: 'Sixth', viewCount: 50, publishedAt: '2026-09-10T04:00:00Z' }), // 6.25/hr, dropped
    ];
    const summary = buildSnapshotSummary({ subscriberCount: 5000, totalViewCount: 100000, videoCount: 40, posts }, NOW);
    expect(summary.topPosts).toHaveLength(5);
    expect(summary.topPosts[0].captionOrTitle).toBe('Fast');
    expect(summary.topPosts.map((p) => p.captionOrTitle)).not.toContain('Sixth');
  });

  it('returns fewer than 5 posts when fewer than 5 were fetched', () => {
    const summary = buildSnapshotSummary(
      { subscriberCount: 100, totalViewCount: 1000, videoCount: 2, posts: [makePost(), makePost()] },
      NOW
    );
    expect(summary.topPosts).toHaveLength(2);
  });

  it('passes subscriberCount, totalViewCount, and videoCount through unchanged', () => {
    const summary = buildSnapshotSummary({ subscriberCount: null, totalViewCount: 5000, videoCount: 12, posts: [] }, NOW);
    expect(summary).toEqual({ subscriberCount: null, totalViewCount: 5000, videoCount: 12, topPosts: [] });
  });
});

describe('computeDeltas', () => {
  it('returns all-null deltas when there is no prior snapshot', () => {
    expect(computeDeltas({ subscriberCount: 100, totalViewCount: 1000, videoCount: 5 }, null)).toEqual({
      subscriberDelta: null,
      totalViewDelta: null,
      videoDelta: null,
      comparedAgainstCapturedAt: null,
    });
  });

  it('computes deltas against a prior snapshot', () => {
    const result = computeDeltas(
      { subscriberCount: 1200, totalViewCount: 50000, videoCount: 42 },
      { subscriberCount: 1000, totalViewCount: 40000, videoCount: 40, capturedAt: '2026-09-03T12:00:00Z' }
    );
    expect(result).toEqual({
      subscriberDelta: 200,
      totalViewDelta: 10000,
      videoDelta: 2,
      comparedAgainstCapturedAt: '2026-09-03T12:00:00Z',
    });
  });

  it('returns a null subscriberDelta when either side has a hidden subscriber count, but still computes view/video deltas', () => {
    const result = computeDeltas(
      { subscriberCount: null, totalViewCount: 50000, videoCount: 42 },
      { subscriberCount: 1000, totalViewCount: 40000, videoCount: 40, capturedAt: '2026-09-03T12:00:00Z' }
    );
    expect(result.subscriberDelta).toBeNull();
    expect(result.totalViewDelta).toBe(10000);
    expect(result.videoDelta).toBe(2);
  });
});
