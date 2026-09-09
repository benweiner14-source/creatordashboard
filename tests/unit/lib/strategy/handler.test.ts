import { describe, it, expect } from 'vitest';
import { handleStrategyBreakdownRequest, STRATEGY_GENERATION_PROFILE_LIMIT } from '@/lib/strategy/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeStrategyClient } from '../../../fakes/claude-strategy.fake';
import { ChannelNotFoundError, type VideoMetadata, type YouTubeClient } from '@/lib/integrations/youtube';
import type { ProfilePost } from '@/lib/integrations/scraper';
import type { FormatMixSummary } from '@/lib/strategy/types';

function createNotFoundYouTubeClient(): YouTubeClient {
  return {
    ...createFakeYouTubeClient(),
    getChannelUploads: async (handle: string) => {
      throw new ChannelNotFoundError(handle);
    },
  };
}

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

  it('keeps a TikTok/Instagram post missing durationSeconds unknown instead of counting it as a 0-second short', async () => {
    const posts: ProfilePost[] = [
      {
        platform: 'instagram',
        id: 'ig1',
        caption: 'Photo post',
        publishedAt: '2026-08-11T10:00:00Z',
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        permalink: 'https://instagram.com/p/ig1',
      },
      {
        platform: 'instagram',
        id: 'ig2',
        caption: 'Reel',
        publishedAt: '2026-08-10T10:00:00Z',
        durationSeconds: 30,
        viewCount: 2000,
        likeCount: 200,
        commentCount: 20,
        permalink: 'https://instagram.com/p/ig2',
      },
    ];
    let savedFormatMix: FormatMixSummary | undefined;
    const deps = makeDeps({
      scraperClient: createFakeScraperClient({}, posts),
      saveStrategyBreakdown: async (params) => {
        savedFormatMix = params.formatMix;
        return { id: 'strategy-1' };
      },
    });
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.instagram.com/creator/',
    });
    expect(result.status).toBe(200);
    // Only the one post with a known duration is bucketed; the photo post is
    // excluded rather than fabricated as a 0-second short-form video.
    expect(savedFormatMix).toEqual({
      averageDurationSeconds: 30,
      shortPct: 100,
      mediumPct: 0,
      longPct: 0,
      postsWithUnknownDuration: 1,
    });
  });

  it('returns a friendly 404 without releasing the rate-limit slot when the YouTube channel does not exist', async () => {
    const deps = makeDeps({ youtubeClient: createNotFoundYouTubeClient() });
    let result;
    for (let i = 0; i < STRATEGY_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleStrategyBreakdownRequest(deps, {
        profileId: 'p1',
        ip: '203.0.113.1',
        url: 'https://www.youtube.com/@nobody',
      });
      expect(result.status).toBe(404);
      expect(result.body.error).toContain("couldn't find that channel");
    }
    // The slot was never refunded, so the sixth attempt is rate-limited --
    // a nonexistent-channel loop can't hammer the YouTube API for free.
    result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@nobody',
    });
    expect(result.status).toBe(429);
  });

  it('releases the rate-limit slot when a genuine internal failure occurs', async () => {
    let failing = true;
    const deps = makeDeps({
      youtubeClient: createFakeYouTubeClient({}, [
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
      ]),
      saveStrategyBreakdown: async () => {
        if (failing) throw new Error('database is down');
        return { id: 'strategy-1' };
      },
    });

    for (let i = 0; i < STRATEGY_GENERATION_PROFILE_LIMIT; i++) {
      await expect(
        handleStrategyBreakdownRequest(deps, {
          profileId: 'p1',
          ip: '203.0.113.1',
          url: 'https://www.youtube.com/@creator',
        })
      ).rejects.toThrow('database is down');
    }

    failing = false;
    const result = await handleStrategyBreakdownRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/@creator',
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
