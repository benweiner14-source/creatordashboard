import { computeViewsPerHour } from '@/lib/metrics';
import type { AggregatablePost, PlatformTotals, RecapAggregation, RecapPlatform } from './types';

export function filterPostsToMonth(
  posts: AggregatablePost[],
  target: { year: number; month: number }
): AggregatablePost[] {
  return posts.filter((post) => {
    if (!post.publishedAt) return false;
    const date = new Date(post.publishedAt);
    if (Number.isNaN(date.getTime())) return false;
    return date.getUTCFullYear() === target.year && date.getUTCMonth() + 1 === target.month;
  });
}

export function aggregateRecap(
  postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>>,
  now: Date = new Date()
): RecapAggregation {
  const platformData: RecapAggregation['platformData'] = {};
  const totals: PlatformTotals = { views: 0, likes: 0, comments: 0, postCount: 0 };
  let topPost: RecapAggregation['topPost'] = null;
  let topPostViewsPerHour = -Infinity;

  for (const platform of Object.keys(postsByPlatform) as RecapPlatform[]) {
    const posts = postsByPlatform[platform];
    if (!posts || posts.length === 0) continue;

    const views = posts.reduce((sum, p) => sum + p.viewCount, 0);
    const likes = posts.reduce((sum, p) => sum + p.likeCount, 0);
    const comments = posts.reduce((sum, p) => sum + p.commentCount, 0);
    platformData[platform] = { views, likes, comments, postCount: posts.length };

    totals.views += views;
    totals.likes += likes;
    totals.comments += comments;
    totals.postCount += posts.length;

    for (const post of posts) {
      // Ranked by views-per-hour rather than raw view count, so a post
      // that's actually accelerating right now beats an older post that
      // simply had more time to accumulate views -- the same VPH metric
      // lib/watchlist/aggregate.ts uses to rank a competitor's top posts.
      const viewsPerHour = computeViewsPerHour(post.viewCount, post.publishedAt, now);
      if (!topPost || viewsPerHour > topPostViewsPerHour) {
        topPost = { platform, captionOrTitle: post.captionOrTitle, viewCount: post.viewCount, permalink: post.permalink };
        topPostViewsPerHour = viewsPerHour;
      }
    }
  }

  return { platformData, totals, topPost };
}
