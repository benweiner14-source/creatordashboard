import { computeEngagementRate } from '@/lib/diagnostic/types';
import type { ChannelPost, CadenceSummary, FormatMixSummary } from './types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeCadence(posts: ChannelPost[]): CadenceSummary {
  if (posts.length === 0) {
    return { postCount: 0, spanDays: 0, postsPerWeek: 0, mostCommonDayOfWeek: null };
  }

  const timestamps = posts.map((p) => new Date(p.publishedAt).getTime()).filter((t) => !Number.isNaN(t));
  const spanMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const spanDays = spanMs / MS_PER_DAY;
  const postsPerWeek = spanDays >= 1 ? (posts.length / spanDays) * 7 : posts.length;

  const dayCounts = new Map<number, number>();
  for (const post of posts) {
    const day = new Date(post.publishedAt).getUTCDay();
    if (Number.isNaN(day)) continue;
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  // posts are most-recent-first from both getChannelUploads and
  // fetchProfilePosts; iterating in that order and only replacing on a
  // strictly greater count means a tie is won by whichever day was
  // encountered first -- the more recently-established pattern.
  let mostCommonDay: number | null = null;
  let mostCommonCount = 0;
  for (const post of posts) {
    const day = new Date(post.publishedAt).getUTCDay();
    if (Number.isNaN(day)) continue;
    const count = dayCounts.get(day)!;
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonDay = day;
    }
  }

  return {
    postCount: posts.length,
    spanDays: Math.round(spanDays * 10) / 10,
    postsPerWeek: Math.round(postsPerWeek * 10) / 10,
    mostCommonDayOfWeek: mostCommonDay !== null ? DAY_NAMES[mostCommonDay] : null,
  };
}

export function computeFormatMix(posts: ChannelPost[]): FormatMixSummary {
  if (posts.length === 0) {
    return { averageDurationSeconds: 0, shortPct: 0, mediumPct: 0, longPct: 0 };
  }

  const durations = posts.map((p) => p.durationSeconds);
  const averageDurationSeconds = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);

  let shortCount = 0;
  let mediumCount = 0;
  let longCount = 0;
  for (const duration of durations) {
    if (duration <= 60) shortCount++;
    else if (duration <= 240) mediumCount++;
    else longCount++;
  }

  return {
    averageDurationSeconds,
    shortPct: Math.round((shortCount / posts.length) * 100),
    mediumPct: Math.round((mediumCount / posts.length) * 100),
    longPct: Math.round((longCount / posts.length) * 100),
  };
}

export function computeAverageEngagementRate(
  platform: 'youtube' | 'tiktok' | 'instagram',
  posts: ChannelPost[]
): number {
  if (posts.length === 0) return 0;
  const rates = posts.map((p) => computeEngagementRate(platform, p.likeCount, p.commentCount, p.viewCount));
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}
