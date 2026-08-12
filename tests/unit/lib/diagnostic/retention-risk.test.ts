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
});
