import { labelForScore, type ScoreResult } from './types';

export interface FormatFitInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
}

interface DurationRange {
  minSeconds: number;
  maxSeconds: number;
}

const IDEAL_RANGES: Record<FormatFitInput['platform'], DurationRange> = {
  tiktok: { minSeconds: 15, maxSeconds: 60 },
  instagram: { minSeconds: 15, maxSeconds: 90 },
  youtube: { minSeconds: 240, maxSeconds: 900 },
};

export function scoreFormatFit(input: FormatFitInput): ScoreResult {
  const range = IDEAL_RANGES[input.platform];
  const reasons: string[] = [];
  let score: number;

  if (input.durationSeconds >= range.minSeconds && input.durationSeconds <= range.maxSeconds) {
    score = 100;
    reasons.push(`Your video's length fits squarely in the range that performs well for ${input.platform}.`);
  } else {
    const distance =
      input.durationSeconds < range.minSeconds
        ? range.minSeconds - input.durationSeconds
        : input.durationSeconds - range.maxSeconds;
    score = Math.max(0, 100 - distance * 2);
    reasons.push(
      input.durationSeconds < range.minSeconds
        ? `Your video is shorter than the range that tends to work well for ${input.platform}, which can limit how much story or value you deliver.`
        : `Your video is longer than the range that tends to work well for ${input.platform}, which raises the chance viewers leave before it ends.`
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: labelForScore(score), reasons };
}
