import { describe, it, expect } from 'vitest';
import { handleStrategyBreakdownRequest, STRATEGY_GENERATION_PROFILE_LIMIT } from '@/lib/strategy/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeStrategyClient } from '../../../fakes/claude-strategy.fake';
import type { VideoMetadata } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';

function makeDeps(overrides: Partial<Parameters<typeof handleStrategyBreakdownRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    claudeStrategyClient: createFakeStrategyClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    saveStrategyBreakdown: async () => ({ id: 'strategy-1' }),
    ...overrides,
  };
}

describe('handleStrategyBreakdownRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleStrategyBreakdownRequest(makeDeps(), {
      profileId: null,
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('rejects an unsupported URL', async () => {
    const result = await handleStrategyBreakdownRequest(makeDeps(), {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://example.com/creator',
    });
    expect(result.status).toBe(400);
  });

  it('generates and saves a breakdown for a YouTube channel', async () => {
    const uploads: VideoMetadata[] = [
      {
        id: 'v1',
        title: 'Video 1',
        description: '',
        publishedAt: '2026-08-11T10:00:00Z',
        durationSeconds: 500,
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        tags: [],
      },
    ];
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, uploads) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(200);
    expect(result.body.id).toBe('strategy-1');
  });

  it('generates and saves a breakdown for a TikTok channel', async () => {
    const posts: ProfilePost[] = [
      {
        platform: 'tiktok',
        id: 't1',
        caption: 'Post',
        publishedAt: '2026-08-11T10:00:00Z',
        durationSeconds: 30,
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        permalink: 'https://tiktok.com/@creator/video/t1',
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, posts) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.tiktok.com/@creator',
    });
    expect(result.status).toBe(200);
  });

  it('defaults a TikTok/Instagram post missing durationSeconds to 0 rather than failing', async () => {
    const posts: ProfilePost[] = [
      {
        platform: 'instagram',
        id: 'ig1',
        caption: 'Post',
        publishedAt: '2026-08-11T10:00:00Z',
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        permalink: 'https://instagram.com/p/ig1',
      },
    ];
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, posts) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.instagram.com/creator/',
    });
    expect(result.status).toBe(200);
  });

  it('returns a distinct 422 without releasing the rate-limit slot when the channel has no public posts', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, []) });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(422);
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ youtubeClient: createFakeYouTubeClient({}, []) });
    let result;
    for (let i = 0; i < STRATEGY_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleStrategyBreakdownRequest(deps, {
        profileId: 'p1',
        ip: '203.0.113.1',
        url: 'https://www.youtube.com/@creator',
      });
      expect(result.status).toBe(422); // zero posts each time, but still consumes an attempt
    }
    result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
    });
    expect(result.status).toBe(429);
  });
});
