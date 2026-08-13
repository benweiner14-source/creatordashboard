import { describe, it, expect } from 'vitest';
import { scoreRetentionRisk } from '@/lib/diagnostic/retention-risk';

describe('scoreRetentionRisk', () => {
  it('scores a well-paced, well-engaged TikTok clip as strong', () => {
    const result = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 28,
      viewCount: 10000,
      likeCount: 900,
      commentCount: 100,
    });
    expect(result.label).toBe('strong');
  });

  it('scores an overly long TikTok clip with weak engagement as weak', () => {
    const result = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 180,
      viewCount: 10000,
      likeCount: 30,
      commentCount: 5,
    });
    expect(result.label).toBe('weak');
  });

  it('returns two reasons covering duration and engagement', () => {
    const result = scoreRetentionRisk({
      platform: 'youtube',
      durationSeconds: 480,
      viewCount: 5000,
      likeCount: 200,
      commentCount: 40,
    });
    expect(result.reasons).toHaveLength(2);
  });

  it('scores a 20-second Instagram Reel at its ideal duration as strong', () => {
    const result = scoreRetentionRisk({
      platform: 'instagram',
      durationSeconds: 20,
      viewCount: 10000,
      likeCount: 300,
      commentCount: 100,
    });
    expect(result.label).toBe('strong');
  });

  // These use deliberately modest engagement (not enough to saturate the
  // engagement-score component at its 60-point cap) so the duration-penalty
  // component actually moves the label — a discriminating test, not one
  // that happens to pass either way because engagement alone maxes the score.
  const MODEST_ENGAGEMENT = { viewCount: 10000, likeCount: 100, commentCount: 20 };

  it('scores a 30-second YouTube video (Shorts-shaped) as strong, using the 30s Shorts ideal instead of the 8-minute long-form anchor', () => {
    const result = scoreRetentionRisk({ platform: 'youtube', durationSeconds: 30, ...MODEST_ENGAGEMENT });
    // At the old 480s anchor this same input scores "weak" (~37) — a 30s
    // video is treated as catastrophically short. At the new 30s Shorts
    // anchor it's exactly on target and should score "strong".
    expect(result.label).toBe('strong');
  });

  it('scores a 45-second YouTube video as moderate rather than weak, once judged against the Shorts ideal', () => {
    const result = scoreRetentionRisk({ platform: 'youtube', durationSeconds: 45, ...MODEST_ENGAGEMENT });
    // At the old 480s anchor this scores "weak" (~38); at the new 30s
    // Shorts anchor (1.5x ideal) it should land in "moderate" territory.
    expect(result.label).toBe('moderate');
  });

  it('still scores a long-form YouTube video (>180s) against the unchanged 8-minute anchor', () => {
    const atLongFormIdeal = scoreRetentionRisk({ platform: 'youtube', durationSeconds: 480, ...MODEST_ENGAGEMENT });
    expect(atLongFormIdeal.label).toBe('strong');
  });

  it('treats exactly 180s as Shorts-shaped and 181s as long-form (boundary)', () => {
    const atBoundary = scoreRetentionRisk({ platform: 'youtube', durationSeconds: 180, ...MODEST_ENGAGEMENT });
    const justOverBoundary = scoreRetentionRisk({ platform: 'youtube', durationSeconds: 181, ...MODEST_ENGAGEMENT });
    // 180s is 6x the 30s Shorts ideal (a steep, capped penalty); 181s
    // flips to the 480s long-form anchor where it's much closer to ideal.
    // Under the old, unbranched implementation these two land on nearly
    // identical scores (~49 both) since both are judged the same way
    // against the same 480s anchor.
    expect(atBoundary.score).toBeLessThan(justOverBoundary.score);
  });

  it('scores a comment-heavy tiktok post higher than a like-heavy one with identical total engagement, at the same (ideal) duration', () => {
    const commentHeavy = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 100,
      commentCount: 200,
    });
    const likeHeavy = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    // Under the old unweighted formula these are identical (both
    // 300/10000). TikTok now weights comments above likes.
    expect(commentHeavy.score).toBeGreaterThan(likeHeavy.score);
  });

  it('does not weight comments over likes on instagram — same total engagement scores identically regardless of split', () => {
    const commentHeavy = scoreRetentionRisk({
      platform: 'instagram',
      durationSeconds: 20,
      viewCount: 10000,
      likeCount: 100,
      commentCount: 200,
    });
    const likeHeavy = scoreRetentionRisk({
      platform: 'instagram',
      durationSeconds: 20,
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    expect(commentHeavy.score).toBe(likeHeavy.score);
  });

  it('scores the same engagement rate differently depending on platform', () => {
    const tiktokResult = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 250,
      commentCount: 50,
    });
    const instagramResult = scoreRetentionRisk({
      platform: 'instagram',
      durationSeconds: 20,
      viewCount: 10000,
      likeCount: 250,
      commentCount: 50,
    });
    expect(tiktokResult.score).not.toBe(instagramResult.score);
  });
});
