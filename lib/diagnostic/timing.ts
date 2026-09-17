import { labelForScore, type ScoreResult } from './types';

export interface TimingInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  publishedAt: string;
}

interface PeakWindow {
  dayOfWeek: number; // 0 = Sunday (UTC)
  startHour: number; // UTC hour, inclusive
  endHour: number; // UTC hour, exclusive
}

// Calibrated 2026-09-17 against a real year of first-party post data (2K's
// own gaming-brand accounts across TikTok/Instagram/YouTube, ~8,600 posts
// with views>0), not the generic secondary-sourced guesses this replaced.
// Methodology: bucketed by UTC day-of-week + 4-hour window (source
// timestamps were US Eastern, converted to UTC accounting for DST), top 5%
// of posts by views excluded per platform first to remove major-announcement
// outliers (e.g. game-reveal trailers dropped at a fixed embargo time
// regardless of "good" posting time — these dominated raw hour-of-day
// medians before trimming), then the 3 highest-median day+window buckets
// with a sample size of at least 25 posts were kept. See
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const PEAK_WINDOWS: Record<TimingInput['platform'], PeakWindow[]> = {
  tiktok: [
    { dayOfWeek: 3, startHour: 20, endHour: 24 },
    { dayOfWeek: 3, startHour: 12, endHour: 16 },
    { dayOfWeek: 1, startHour: 20, endHour: 24 },
  ],
  instagram: [
    { dayOfWeek: 3, startHour: 0, endHour: 4 },
    { dayOfWeek: 4, startHour: 16, endHour: 20 },
    { dayOfWeek: 1, startHour: 20, endHour: 24 },
  ],
  youtube: [
    { dayOfWeek: 2, startHour: 12, endHour: 16 },
    { dayOfWeek: 3, startHour: 12, endHour: 16 },
    { dayOfWeek: 3, startHour: 16, endHour: 20 },
  ],
};

function hoursFromWindow(hour: number, window: PeakWindow): number {
  if (hour >= window.startHour && hour < window.endHour) return 0;
  const distanceToStart = Math.min(Math.abs(hour - window.startHour), 24 - Math.abs(hour - window.startHour));
  const distanceToEnd = Math.min(Math.abs(hour - window.endHour), 24 - Math.abs(hour - window.endHour));
  return Math.min(distanceToStart, distanceToEnd);
}

export function scoreTiming(input: TimingInput): ScoreResult {
  const published = new Date(input.publishedAt);
  const dayOfWeek = published.getUTCDay();
  const hour = published.getUTCHours();
  const windows = PEAK_WINDOWS[input.platform];

  let bestDistance = Infinity;
  for (const window of windows) {
    const dayDistance = Math.min(Math.abs(dayOfWeek - window.dayOfWeek), 7 - Math.abs(dayOfWeek - window.dayOfWeek));
    const hourDistance = hoursFromWindow(hour, window);
    bestDistance = Math.min(bestDistance, dayDistance * 24 + hourDistance);
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - bestDistance * 4)));
  const reasons: string[] =
    bestDistance === 0
      ? [`You posted during one of the windows when ${input.platform} audiences are typically most active, giving your post a better chance at early views.`]
      : [`You posted outside the windows when ${input.platform} audiences are typically most active, which can mean fewer people see it in the first crucial hour.`];

  return { score, label: labelForScore(score), reasons };
}
