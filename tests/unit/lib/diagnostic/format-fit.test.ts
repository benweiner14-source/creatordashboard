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

  it('scores a 45-second YouTube video (Shorts-shaped) as strong, using the Shorts range instead of the long-form range', () => {
    const result = scoreFormatFit({ platform: 'youtube', durationSeconds: 45 });
    // Under the pre-fix single long-form range (240-900s), 45s is 195s
    // below the floor and would score far from 100. Under the Shorts
    // range (15-90s), 45s is squarely inside it.
    expect(result.score).toBe(100);
  });

  it('scores a 100-second YouTube video much better than the old long-form-only assumption would have', () => {
    const result = scoreFormatFit({ platform: 'youtube', durationSeconds: 100 });
    // 100s is outside the Shorts sweet spot (15-90s, 10s over -> score 80)
    // but nowhere near as bad as being judged against the long-form range
    // (240-900s, 140s under the floor -> score 0 under the old code).
    expect(result.score).toBe(80);
  });

  it('scores a 150-second Instagram Reel as strong, reflecting the wider Explore-eligibility ceiling', () => {
    const result = scoreFormatFit({ platform: 'instagram', durationSeconds: 150 });
    // Under the pre-fix 15-90s range, 150s is 60s over the ceiling and
    // would score well below 100. Per docs/platform-monitoring-log.md's
    // 2026-09-01 entry, Reels up to 3 minutes (180s) are now eligible for
    // Explore/non-follower distribution, so 150s should fit squarely.
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('scores a 240-second Instagram Reel as worse than 150s, since 3 minutes is still the eligibility ceiling', () => {
    const at150 = scoreFormatFit({ platform: 'instagram', durationSeconds: 150 });
    const at240 = scoreFormatFit({ platform: 'instagram', durationSeconds: 240 });
    expect(at240.score).toBeLessThan(at150.score);
  });

  it('uses Shorts-specific reasoning at 180s and long-form reasoning at 181s (boundary)', () => {
    const atBoundary = scoreFormatFit({ platform: 'youtube', durationSeconds: 180 });
    const justOverBoundary = scoreFormatFit({ platform: 'youtube', durationSeconds: 181 });
    // Both durations land far outside their respective ranges, so their
    // scores alone don't cleanly distinguish the two branches (they can
    // both clamp toward 0) — the reasoning text is the reliable signal
    // that the correct range was actually selected.
    expect(atBoundary.reasons[0]).toContain('YouTube Shorts');
    expect(justOverBoundary.reasons[0]).not.toContain('Shorts');
  });
});
