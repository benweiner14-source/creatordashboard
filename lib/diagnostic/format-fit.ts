import { labelForScore, isLikelyYouTubeShort, type ScoreResult } from './types';

export interface FormatFitInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
}

interface DurationRange {
  minSeconds: number;
  maxSeconds: number;
}

// YouTube Shorts (capped at 180s) get their own range, separate from
// long-form YouTube — best-performing Shorts cluster at 30-60s, with a
// 15s floor matching the sibling short-form platforms (no YouTube-specific
// floor is sourced) and a 90s ceiling giving headroom past the 30-60s
// core before the falloff kicks in. See
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const IDEAL_RANGES: Record<FormatFitInput['platform'], DurationRange> = {
  tiktok: { minSeconds: 15, maxSeconds: 60 },
  instagram: { minSeconds: 15, maxSeconds: 90 },
  youtube: { minSeconds: 240, maxSeconds: 900 },
};
const YOUTUBE_SHORTS_IDEAL_RANGE: DurationRange = { minSeconds: 15, maxSeconds: 90 };

export function scoreFormatFit(input: FormatFitInput): ScoreResult {
  const isShort = isLikelyYouTubeShort(input.platform, input.durationSeconds);
  const range = isShort ? YOUTUBE_SHORTS_IDEAL_RANGE : IDEAL_RANGES[input.platform];
  const platformLabel = isShort ? 'YouTube Shorts' : input.platform;
  const reasons: string[] = [];
  let score: number;

  if (input.durationSeconds >= range.minSeconds && input.durationSeconds <= range.maxSeconds) {
    score = 100;
    reasons.push(`Your video's length fits squarely in the range that performs well for ${platformLabel}.`);
  } else {
    const distance =
      input.durationSeconds < range.minSeconds
        ? range.minSeconds - input.durationSeconds
        : input.durationSeconds - range.maxSeconds;
    score = Math.max(0, 100 - distance * 2);
    reasons.push(
      input.durationSeconds < range.minSeconds
        ? `Your video is shorter than the range that tends to work well for ${platformLabel}, which can limit how much story or value you deliver.`
        : `Your video is longer than the range that tends to work well for ${platformLabel}, which raises the chance viewers leave before it ends.`
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: labelForScore(score), reasons };
}
