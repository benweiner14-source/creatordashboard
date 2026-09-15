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
 * system's real, tuned "Standard" tier (see design spec §3) — this build
 * only does hashtag/keyword discovery, so the reference's separate "big
 * account" tier (for a curated list of known profiles) does not apply.
 * YouTube has no reference precedent and uses this codebase's own
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
    if (post.viewCount >= 1_000_000 || post.engagementCount >= 20_000) return 'already_viral';
    if ((post.viewCount >= 300_000 || post.engagementCount >= 8_000) && ageMin <= 180) return 'going_viral';
    if ((post.viewCount >= 100_000 || post.engagementCount >= 2_000) && ageMin <= 240) return 'heating_up';
    return null;
  }

  if (post.platform === 'instagram') {
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
