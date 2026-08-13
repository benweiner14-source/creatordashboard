import { describe, it, expect } from 'vitest';
import { scoreHookStrength } from '@/lib/diagnostic/hook-strength';

describe('scoreHookStrength', () => {
  it('scores high engagement with a curiosity-pattern caption as strong', () => {
    const result = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'How I got 10k views in 3 days',
      viewCount: 10000,
      likeCount: 800,
      commentCount: 200,
    });
    expect(result.label).toBe('strong');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores low engagement with a plain caption as weak', () => {
    const result = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'My new video',
      viewCount: 10000,
      likeCount: 20,
      commentCount: 5,
    });
    expect(result.label).toBe('weak');
    expect(result.score).toBeLessThan(40);
  });

  it('always returns at least one reason explaining the score', () => {
    const result = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 100,
      likeCount: 1,
      commentCount: 0,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('reads a 2.6% engagement rate as moderate on Instagram (Reels benchmark average)', () => {
    const result = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'New post',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 60,
    });
    expect(result.label).toBe('moderate');
  });

  it('scores a comment-heavy tiktok post higher than a like-heavy one with identical total engagement', () => {
    const commentHeavy = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 100,
      commentCount: 200,
    });
    const likeHeavy = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    // Under the old unweighted (likes+comments)/views formula these are
    // identical (both sum to 300/10000). TikTok now weights comments
    // above likes, so the comment-heavy post should score higher.
    expect(commentHeavy.score).toBeGreaterThan(likeHeavy.score);
  });

  it('does not weight comments over likes on instagram — same total engagement scores identically regardless of split', () => {
    const commentHeavy = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 100,
      commentCount: 200,
    });
    const likeHeavy = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    expect(commentHeavy.score).toBe(likeHeavy.score);
  });

  it('gives a TikTok post a distribution bonus when shares+saves are disproportionately high relative to likes', () => {
    const baseline = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    const shareHeavy = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
      shareCount: 50,
      saveCount: 50,
    });
    expect(shareHeavy.score).toBeGreaterThan(baseline.score);
  });

  it('does not apply the distribution bonus when shares+saves are a small fraction of likes', () => {
    const baseline = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    });
    const smallShares = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
      shareCount: 1,
      saveCount: 1,
    });
    expect(smallShares.score).toBe(baseline.score);
  });

  it('never applies the distribution bonus on instagram, even with a huge share/save ratio', () => {
    const result = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 10,
      commentCount: 5,
      shareCount: 1000,
      saveCount: 1000,
    });
    const withoutShares = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 10,
      commentCount: 5,
    });
    expect(result.score).toBe(withoutShares.score);
  });

  it('scores the same 4% engagement rate differently depending on platform', () => {
    const tiktokResult = scoreHookStrength({
      platform: 'tiktok',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 300,
      commentCount: 100,
    });
    const instagramResult = scoreHookStrength({
      platform: 'instagram',
      captionOrTitle: 'Untitled',
      viewCount: 10000,
      likeCount: 300,
      commentCount: 100,
    });
    expect(tiktokResult.label).toBe('moderate');
    expect(instagramResult.label).toBe('strong');
  });
});
