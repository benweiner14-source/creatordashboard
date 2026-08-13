export type ScoreLabel = 'weak' | 'moderate' | 'strong';

export interface ScoreResult {
  score: number;
  label: ScoreLabel;
  reasons: string[];
}

export function labelForScore(score: number): ScoreLabel {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}

// YouTube's own eligibility cutoff for what counts as a Short (extended
// from 60s to 3 minutes in October 2024, still current). Used as a proxy
// for "this video is Shorts-shaped" since the app doesn't otherwise know
// whether a /watch URL was published/distributed as a Short.
export const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;

export function isLikelyYouTubeShort(
  platform: 'youtube' | 'tiktok' | 'instagram',
  durationSeconds: number
): boolean {
  return platform === 'youtube' && durationSeconds <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS;
}
