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
  // Numerator and denominator must describe the same posts: a post whose
  // publishedAt didn't parse contributes nothing to the span, so counting it
  // in the rate would overstate cadence on dirty scraper data.
  const postsPerWeek = spanDays >= 1 ? (timestamps.length / spanDays) * 7 : timestamps.length;

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

/**
 * Rounds counts to whole percentages that always sum to 100, handing the
 * leftover point(s) to the buckets with the largest fractional remainder.
 * Rounding each bucket independently can produce 99 or 101, which reads as a
 * bug on a page that presents them as a mix of the whole.
 */
function percentagesSummingTo100(counts: number[], total: number): number[] {
  const exact = counts.map((count) => (count / total) * 100);
  const percentages = exact.map((value) => Math.floor(value));
  let leftover = 100 - percentages.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    percentages[index] += 1;
    leftover -= 1;
  }
  return percentages;
}

export function computeFormatMix(posts: ChannelPost[]): FormatMixSummary {
  // Posts with no duration are excluded from the buckets and the average
  // rather than treated as 0-second shorts: Apify's Instagram scraper only
  // reports duration for videos, so counting photos/carousels as 0s would
  // fabricate short-form videos and skew every number here -- numbers Claude
  // then narrates to the creator as fact. The percentages describe only the
  // posts we could actually measure; postsWithUnknownDuration says how many
  // were left out.
  const durations = posts
    .map((post) => post.durationSeconds)
    .filter((duration): duration is number => typeof duration === 'number' && !Number.isNaN(duration));
  const postsWithUnknownDuration = posts.length - durations.length;

  if (durations.length === 0) {
    return { averageDurationSeconds: 0, shortPct: 0, mediumPct: 0, longPct: 0, postsWithUnknownDuration };
  }

  const averageDurationSeconds = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);

  let shortCount = 0;
  let mediumCount = 0;
  let longCount = 0;
  for (const duration of durations) {
    if (duration <= 60) shortCount++;
    else if (duration <= 240) mediumCount++;
    else longCount++;
  }

  const [shortPct, mediumPct, longPct] = percentagesSummingTo100(
    [shortCount, mediumCount, longCount],
    durations.length
  );

  return { averageDurationSeconds, shortPct, mediumPct, longPct, postsWithUnknownDuration };
}

export function computeAverageEngagementRate(
  platform: 'youtube' | 'tiktok' | 'instagram',
  posts: ChannelPost[]
): number {
  if (posts.length === 0) return 0;
  const rates = posts.map((p) => computeEngagementRate(platform, p.likeCount, p.commentCount, p.viewCount));
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}
