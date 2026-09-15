import { describe, it, expect } from 'vitest';
import { detectHandlePlatform, normalizeHandle } from '@/lib/recap/handles';
import { SUGGESTED_CREATORS } from '@/lib/watchlist/suggested-creators';

describe('SUGGESTED_CREATORS', () => {
  it('is not empty', () => {
    expect(SUGGESTED_CREATORS.length).toBeGreaterThan(0);
  });

  it.each(SUGGESTED_CREATORS)('$platform $label — url resolves to a real handle for its declared platform', (creator) => {
    // Exercises the exact same validation the manual add-competitor form
    // goes through (lib/watchlist/handler.ts), so a typo'd url here fails
    // this test instead of silently producing a dead quick-add chip.
    expect(detectHandlePlatform(creator.url)).toBe(creator.platform);
    const handle = normalizeHandle(creator.platform, creator.url);
    expect(handle).not.toBeNull();
    expect(handle).not.toHaveLength(0);
  });

  it('has no duplicate (platform, url) pairs', () => {
    const seen = new Set(SUGGESTED_CREATORS.map((c) => `${c.platform}:${c.url}`));
    expect(seen.size).toBe(SUGGESTED_CREATORS.length);
  });
});
