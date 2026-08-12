import { describe, it, expect } from 'vitest';
import { scoreFormatFit } from '@/lib/diagnostic/format-fit';

describe('scoreFormatFit', () => {
  it('scores a TikTok video within the ideal range as strong', () => {
    const result = scoreFormatFit({ platform: 'tiktok', durationSeconds: 30 });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('scores a TikTok video far outside the ideal range as weak', () => {
    const result = scoreFormatFit({ platform: 'tiktok', durationSeconds: 300 });
    expect(result.label).toBe('weak');
  });

  it('scores a YouTube video within the ideal long-form range as strong', () => {
    const result = scoreFormatFit({ platform: 'youtube', durationSeconds: 600 });
    expect(result.score).toBe(100);
  });
});
