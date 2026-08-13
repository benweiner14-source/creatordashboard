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
  postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>>
): RecapAggregation {
  const platformData: RecapAggregation['platformData'] = {};
  const totals: PlatformTotals = { views: 0, likes: 0, comments: 0, postCount: 0 };
  let topPost: RecapAggregation['topPost'] = null;

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
      if (!topPost || post.viewCount > topPost.viewCount) {
        topPost = { platform, captionOrTitle: post.captionOrTitle, viewCount: post.viewCount, permalink: post.permalink };
      }
    }
  }

  return { platformData, totals, topPost };
}
