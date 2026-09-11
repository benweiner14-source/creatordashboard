import { computeViewsPerHour } from '@/lib/metrics';
import type { ChannelSnapshotInput, RankedPost, SnapshotSummary, SnapshotDeltaInput, SnapshotDeltas } from './types';

// Re-exported so existing callers/imports of computeViewsPerHour from this
// module (it originated here) keep working unchanged now that the shared,
// feature-agnostic implementation lives in lib/metrics.ts for reuse by
// lib/recap/aggregate.ts and lib/strategy/handler.ts.
export { computeViewsPerHour };

const TOP_POSTS_LIMIT = 5;

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
