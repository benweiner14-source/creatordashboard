import { describe, it, expect } from 'vitest';
import { scoreTiming } from '@/lib/diagnostic/timing';

describe('scoreTiming', () => {
  it('scores a post inside a known peak window as strong', () => {
    // 2026-08-11 is a Tuesday (UTC day 2); 19:00 UTC is within the TikTok peak window.
    const result = scoreTiming({ platform: 'tiktok', publishedAt: '2026-08-11T19:00:00Z' });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('scores a post far from any peak window lower', () => {
    // 2026-08-12 is a Wednesday (UTC day 3); 04:00 UTC is far from all TikTok peak windows.
    const result = scoreTiming({ platform: 'tiktok', publishedAt: '2026-08-12T04:00:00Z' });
    expect(result.score).toBeLessThan(100);
  });

  it('explains the timing reason in plain English', () => {
    const result = scoreTiming({ platform: 'youtube', publishedAt: '2026-08-14T10:00:00Z' });
    expect(result.reasons[0]).toContain('youtube');
  });
});
