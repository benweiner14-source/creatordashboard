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

// TikTok is documented (2026-08 platform-monitoring finding) as weighting
// comments above likes in its ranking algorithm. No platform discloses an
// exact ratio, so 2x is a conservative, clearly-labeled estimate, not a
// sourced number — modest enough to stay within the ~2x disagreement the
// benchmark doc's own cited sources (Sprout Social vs. Hootsuite) already
// show for these platforms' engagement-rate averages, so it doesn't
// overclaim precision the underlying research doesn't have either.
// Instagram and YouTube are left at 1x (unweighted): Instagram's confirmed
// shift is toward sends/saves, not comments, and neither signal is
// obtainable through public scraping; YouTube has no sourced
// engagement-weighting signal at all. See
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const TIKTOK_COMMENT_WEIGHT = 2;

export function computeEngagementRate(
  platform: 'youtube' | 'tiktok' | 'instagram',
  likeCount: number,
  commentCount: number,
  viewCount: number
): number {
  const views = Math.max(viewCount, 1);
  const commentWeight = platform === 'tiktok' ? TIKTOK_COMMENT_WEIGHT : 1;
  return (likeCount + commentCount * commentWeight) / views;
}
