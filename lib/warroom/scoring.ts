import { computeViewsPerHour } from '@/lib/metrics';
import type { DiscoveredPost, WarroomSeverity } from './types';

const MS_PER_MINUTE = 60 * 1000;
const MAX_AGE_MINUTES = 48 * 60;

function ageMinutes(publishedAt: string, now: Date): number {
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) return Infinity;
  return (now.getTime() - publishedMs) / MS_PER_MINUTE;
}

/**
 * Thresholds for TikTok/Instagram are the reference Social War Room
 * system's real, tuned "Standard" tier (see design spec §3) for
 * hashtag/keyword-discovered posts, plus its "big account" tier (§2/§9
 * non-goal, later implemented — discovery/big-accounts.ts) for posts from
 * the curated known-profile list, marked via `post.isBigAccount`. YouTube
 * has no reference precedent (neither tier) and uses this codebase's own
 * computeViewsPerHour, the same function Watchlist/Recap/Strategy use.
 *
 * A post older than 48 hours is dropped before any tier check runs, full
 * stop — "(no age limit)" on an individual tier below means that tier's
 * own numeric threshold carries no *additional* age condition beyond this
 * universal cutoff, not that the tier is literally unbounded in age.
 */
export function classifySeverity(post: DiscoveredPost, now: Date): WarroomSeverity | null {
  const ageMin = ageMinutes(post.publishedAt, now);
  if (ageMin > MAX_AGE_MINUTES) return null;

  if (post.platform === 'tiktok') {
    if (post.isBigAccount) {
      // The reference's big-account TikTok tier has no already_viral branch —
      // a known account's raw numbers are less surprising, so it only ever
      // reaches going_viral/heating_up, never the top tier, no matter how
      // large. Reproduced verbatim, not a bug.
      if ((post.viewCount >= 200_000 || post.engagementCount >= 10_000) && ageMin <= 120) return 'going_viral';
      if ((post.viewCount >= 75_000 || post.engagementCount >= 2_000) && ageMin <= 240) return 'heating_up';
      return null;
    }
    if (post.viewCount >= 1_000_000 || post.engagementCount >= 20_000) return 'already_viral';
    if ((post.viewCount >= 300_000 || post.engagementCount >= 8_000) && ageMin <= 180) return 'going_viral';
    if ((post.viewCount >= 100_000 || post.engagementCount >= 2_000) && ageMin <= 240) return 'heating_up';
    return null;
  }

  if (post.platform === 'instagram') {
    if (post.isBigAccount) {
      // Unlike the standard IG tier (engagement-only), the reference's
      // big-account tier also accepts a view-count path — a known account's
      // view count is trustworthy at a glance, so it's checked directly
      // instead of only inferring reach from engagement.
      if ((post.viewCount >= 500_000 || post.engagementCount >= 20_000) && ageMin <= 1440) return 'already_viral';
      if ((post.viewCount >= 200_000 || post.engagementCount >= 8_000) && ageMin <= 120) return 'going_viral';
      if ((post.viewCount >= 50_000 || post.engagementCount >= 2_000) && ageMin <= 240) return 'heating_up';
      return null;
    }
    if (post.engagementCount >= 15_000) return 'already_viral';
    if (post.engagementCount >= 6_000 && ageMin <= 120) return 'going_viral';
    if (post.engagementCount >= 2_500 && ageMin <= 180) return 'heating_up';
    return null;
  }

  // youtube
  const viewsPerHour = computeViewsPerHour(post.viewCount, post.publishedAt, now);
  if (viewsPerHour >= 5_000 || post.viewCount >= 200_000) return 'already_viral';
  if (viewsPerHour >= 2_000 && ageMin < 12 * 60) return 'going_viral';
  if (viewsPerHour >= 500 && ageMin < 24 * 60) return 'heating_up';
  return null;
}
