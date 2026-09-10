import type { ChannelSnapshotInput, RankedPost, SnapshotSummary, SnapshotDeltaInput, SnapshotDeltas } from './types';

const TOP_POSTS_LIMIT = 5;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * A post published less than an hour ago uses a 1-hour floor rather than the
 * true elapsed time, so a brand-new upload doesn't produce an artificially
 * explosive (or Infinity, at t=0) views-per-hour figure.
 */
export function computeViewsPerHour(viewCount: number, publishedAt: string, now: Date = new Date()): number {
  const publishedMs = new Date(publishedAt).getTime();
  const hoursElapsed = Math.max((now.getTime() - publishedMs) / MS_PER_HOUR, 1);
  return viewCount / hoursElapsed;
}

export function buildSnapshotSummary(input: ChannelSnapshotInput, now: Date = new Date()): SnapshotSummary {
  const ranked: RankedPost[] = input.posts
    .map((post) => ({ ...post, viewsPerHour: computeViewsPerHour(post.viewCount, post.publishedAt, now) }))
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour)
    .slice(0, TOP_POSTS_LIMIT);

  return {
    subscriberCount: input.subscriberCount,
    totalViewCount: input.totalViewCount,
    videoCount: input.videoCount,
    topPosts: ranked,
  };
}

export function computeDeltas(
  latest: SnapshotDeltaInput,
  previous: (SnapshotDeltaInput & { capturedAt: string }) | null
): SnapshotDeltas {
  if (!previous) {
    return { subscriberDelta: null, totalViewDelta: null, videoDelta: null, comparedAgainstCapturedAt: null };
  }
  return {
    subscriberDelta:
      latest.subscriberCount !== null && previous.subscriberCount !== null
        ? latest.subscriberCount - previous.subscriberCount
        : null,
    totalViewDelta: latest.totalViewCount - previous.totalViewCount,
    videoDelta: latest.videoCount - previous.videoCount,
    comparedAgainstCapturedAt: previous.capturedAt,
  };
}
