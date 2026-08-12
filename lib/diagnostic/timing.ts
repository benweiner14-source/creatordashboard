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

const PEAK_WINDOWS: Record<TimingInput['platform'], PeakWindow[]> = {
  tiktok: [
    { dayOfWeek: 2, startHour: 18, endHour: 22 },
    { dayOfWeek: 4, startHour: 18, endHour: 22 },
    { dayOfWeek: 6, startHour: 10, endHour: 14 },
  ],
  instagram: [
    { dayOfWeek: 1, startHour: 17, endHour: 21 },
    { dayOfWeek: 3, startHour: 17, endHour: 21 },
    { dayOfWeek: 5, startHour: 11, endHour: 14 },
  ],
  youtube: [
    { dayOfWeek: 5, startHour: 14, endHour: 18 },
    { dayOfWeek: 6, startHour: 9, endHour: 12 },
    { dayOfWeek: 0, startHour: 9, endHour: 12 },
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
