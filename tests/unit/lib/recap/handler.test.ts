import { describe, it, expect, vi } from 'vitest';
import { handleRecapRequest, RECAP_GENERATION_PROFILE_LIMIT } from '@/lib/recap/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';
import type { RecapCardRow, RecapHandles } from '@/lib/recap/types';
import type { RecapHandlerDeps } from '@/lib/recap/handler';

function makeDeps(overrides: Partial<Parameters<typeof handleRecapRequest>[0]> = {}): RecapHandlerDeps {
  const savedCards: RecapCardRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    getProfileHandles: async (): Promise<RecapHandles> => ({ youtube: 'creator', tiktok: null, instagram: null }),
    getExistingRecapCard: async () => null,
    saveRecapCard: async (params) => {
      const row: RecapCardRow = { id: `card-${savedCards.length + 1}`, profileId: params.profileId, month: params.month, platformData: params.platformData, totals: params.totals, topPost: params.topPost, warnings: params.warnings, generatedAt: '2026-08-13T00:00:00Z' };
      savedCards.push(row);
      return row;
    },
    getPlatformConnection: async () => ({ status: 'not_connected' as const }),
    oauthClients: {
      tiktok: createFakeOAuthProviderClient(),
      instagram: createFakeOAuthProviderClient(),
    },
    ...overrides,
  };
}

const NOW = new Date('2026-08-13T12:00:00Z');

describe('handleRecapRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleRecapRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('rejects when no platform handle is connected', async () => {
    const deps = makeDeps({ getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }) });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('returns the existing card for this month without scraping again', async () => {
    const scraperClient = createFakeScraperClient();
    const fetchProfilePostsSpy = vi.spyOn(scraperClient, 'fetchProfilePosts');
    const existing: RecapCardRow = {
      id: 'card-existing', profileId: 'p1', month: '2026-08-01',
      platformData: {}, totals: { views: 0, likes: 0, comments: 0, postCount: 0 },
      topPost: { platform: 'youtube', captionOrTitle: 'x', viewCount: 0, permalink: '' },
      warnings: [], generatedAt: '2026-08-01T00:00:00Z',
    };
    const deps = makeDeps({ scraperClient, getExistingRecapCard: async () => existing });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ recapCard: existing });
    expect(fetchProfilePostsSpy).not.toHaveBeenCalled();
  });

  it('aggregates posts from every connected platform and saves a new card', async () => {
    const youtubeClient = createFakeYouTubeClient(
      {},
      [
        {
          id: 'v1', title: 'YT this month', description: '', publishedAt: '2026-08-05T00:00:00Z',
          durationSeconds: 60, viewCount: 3000, likeCount: 200, commentCount: 10, tags: [], channelId: 'fake-channel-id',
        },
      ]
    );
    const deps = makeDeps({
      youtubeClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
      scraperClient: createFakeScraperClient({}, [
        { platform: 'tiktok', id: 't1', caption: 'TikTok this month', publishedAt: '2026-08-06T00:00:00Z', viewCount: 9000, likeCount: 500, commentCount: 30, permalink: 'https://tiktok.com/@creator/video/t1' },
      ]),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals).toEqual({ views: 12000, likes: 700, comments: 40, postCount: 2 });
    expect(body.recapCard.topPost.platform).toBe('tiktok');
    expect(body.recapCard.warnings).toEqual([]);
  });

  it('records a warning and continues when one platform fails, instead of failing the whole request', async () => {
    const scraperClient = createFakeScraperClient({}, [
      { platform: 'tiktok', id: 't1', caption: 'ok', publishedAt: '2026-08-06T00:00:00Z', viewCount: 100, likeCount: 5, commentCount: 1, permalink: 'https://tiktok.com/@creator/video/t1' },
    ]);
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('boom'));
    const deps = makeDeps({
      youtubeClient,
      scraperClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.warnings).toEqual(['youtube_scrape_failed']);
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('returns a distinct 422 without saving a card when every connected platform is empty this month', async () => {
    const deps = makeDeps({
      scraperClient: createFakeScraperClient({}, []),
      youtubeClient: createFakeYouTubeClient({}, []),
    });
    const saveRecapCardSpy = vi.spyOn(deps, 'saveRecapCard');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
    expect(saveRecapCardSpy).not.toHaveBeenCalled();
  });

  it('reports a total outage distinctly from a genuinely empty month, and gives the attempt back', async () => {
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('youtube down'));
    const scraperClient = createFakeScraperClient();
    vi.spyOn(scraperClient, 'fetchProfilePosts').mockRejectedValue(new Error('apify down'));
    const deps = makeDeps({
      youtubeClient,
      scraperClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
    });
    const saveRecapCardSpy = vi.spyOn(deps, 'saveRecapCard');
    const releaseEventSpy = vi.spyOn(deps.rateLimitStore, 'releaseEvent');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });

    expect(result.status).toBe(503);
    expect(result.body.error).not.toMatch(/nothing was published/i);
    expect(result.body.error).toMatch(/couldn't reach any of your connected platforms/i);
    expect(result.body.warnings).toEqual(['youtube_scrape_failed', 'tiktok_scrape_failed']);
    expect(saveRecapCardSpy).not.toHaveBeenCalled();
    // The scrape never really ran, so it must not burn one of today's attempts.
    expect(releaseEventSpy).toHaveBeenCalledTimes(1);
  });

  it('does not consume an attempt across repeated total outages', async () => {
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('youtube down'));
    const deps = makeDeps({ youtubeClient });

    for (let i = 0; i < RECAP_GENERATION_PROFILE_LIMIT + 2; i++) {
      const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
      expect(result.status).toBe(503);
    }
  });

  it('still calls an empty month empty when the platform that failed was not the only one connected', async () => {
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('youtube down'));
    const deps = makeDeps({
      youtubeClient,
      scraperClient: createFakeScraperClient({}, []),
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
    });
    const releaseEventSpy = vi.spyOn(deps.rateLimitStore, 'releaseEvent');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });

    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/nothing was published/i);
    expect(result.body.warnings).toEqual(['youtube_scrape_failed']);
    expect(releaseEventSpy).not.toHaveBeenCalled();
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, []), youtubeClient: createFakeYouTubeClient({}, []) });
    let result;
    for (let i = 0; i < RECAP_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
      expect(result.status).toBe(422); // nothing published, but still consumes an attempt
    }
    result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(429);
  });

  it('uses the OAuth-connected platform instead of the Apify path when a connection exists', async () => {
    const scraperClient = createFakeScraperClient();
    const fetchProfilePostsSpy = vi.spyOn(scraperClient, 'fetchProfilePosts');
    const oauthFetchSpy = vi.fn(async () => [
      { platform: 'tiktok' as const, id: 'oauth-1', caption: 'via OAuth', publishedAt: '2026-08-06T00:00:00Z', viewCount: 5000, likeCount: 300, commentCount: 20, permalink: 'https://tiktok.com/@creator/video/oauth-1' },
    ]);
    const deps = makeDeps({
      scraperClient,
      getProfileHandles: async () => ({ youtube: null, tiktok: 'creator', instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'tiktok' ? { status: 'connected' as const, accessToken: 'access-1' } : { status: 'not_connected' as const },
      oauthClients: {
        tiktok: createFakeOAuthProviderClient({ fetchProfilePosts: oauthFetchSpy }),
        instagram: createFakeOAuthProviderClient(),
      },
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(oauthFetchSpy).toHaveBeenCalledWith('access-1');
    expect(fetchProfilePostsSpy).not.toHaveBeenCalled();
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('falls back to the Apify/handle path when a platform has a handle but no connection', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: 'creator', instagram: null }),
      scraperClient: createFakeScraperClient({}, [
        { platform: 'tiktok', id: 't1', caption: 'via Apify', publishedAt: '2026-08-06T00:00:00Z', viewCount: 100, likeCount: 5, commentCount: 1, permalink: 'https://tiktok.com/@creator/video/t1' },
      ]),
    });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('allows generation from a connection alone, with no handle saved for that platform', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'tiktok' ? { status: 'connected' as const, accessToken: 'access-1' } : { status: 'not_connected' as const },
      oauthClients: {
        tiktok: createFakeOAuthProviderClient({
          fetchProfilePosts: async () => [
            { platform: 'tiktok' as const, id: 'oauth-1', caption: 'connected only', publishedAt: '2026-08-06T00:00:00Z', viewCount: 10, likeCount: 1, commentCount: 0, permalink: 'https://tiktok.com/@creator/video/oauth-1' },
          ],
        }),
        instagram: createFakeOAuthProviderClient(),
      },
    });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
  });

  it('rejects when neither a handle nor a connection exists for any platform', async () => {
    const deps = makeDeps({ getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }) });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('warns connection_expired for a platform whose refresh token was definitively invalidated, falling back to its saved handle', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: 'creator', instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'tiktok' ? { status: 'connection_expired' as const } : { status: 'not_connected' as const },
      scraperClient: createFakeScraperClient({}, [
        { platform: 'tiktok', id: 't1', caption: 'via Apify fallback', publishedAt: '2026-08-06T00:00:00Z', viewCount: 100, likeCount: 5, commentCount: 1, permalink: 'https://tiktok.com/@creator/video/t1' },
      ]),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.warnings).toContain('tiktok_connection_expired');
  });

  it('flags instagram_views_unavailable when Instagram posts come from the OAuth connection', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'instagram' ? { status: 'connected' as const, accessToken: 'access-1' } : { status: 'not_connected' as const },
      oauthClients: {
        tiktok: createFakeOAuthProviderClient(),
        instagram: createFakeOAuthProviderClient({
          fetchProfilePosts: async () => [
            { platform: 'instagram' as const, id: 'ig-1', caption: 'via OAuth', publishedAt: '2026-08-06T00:00:00Z', viewCount: 0, likeCount: 40, commentCount: 2, permalink: 'https://instagram.com/p/ig-1' },
          ],
        }),
      },
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.warnings).toContain('instagram_views_unavailable');
  });

  it('does not flag instagram_views_unavailable when Instagram data came from the Apify handle path', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: 'creator' }),
      scraperClient: createFakeScraperClient({}, [
        { platform: 'instagram', id: 'ig-1', caption: 'via Apify', publishedAt: '2026-08-06T00:00:00Z', viewCount: 500, likeCount: 40, commentCount: 2, permalink: 'https://instagram.com/p/ig-1' },
      ]),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.warnings).not.toContain('instagram_views_unavailable');
  });

  it('reports a genuinely quiet month (422), not a false outage (503), when the only warning is instagram_views_unavailable', async () => {
    // Regression: instagram_views_unavailable is pushed on a SUCCESSFUL
    // OAuth fetch, not a failure. If the outage check counted it as a
    // failure it would wrongly 503 ("couldn't reach") a real empty month.
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'instagram' ? { status: 'connected' as const, accessToken: 'access-1' } : { status: 'not_connected' as const },
      oauthClients: {
        tiktok: createFakeOAuthProviderClient(),
        instagram: createFakeOAuthProviderClient({ fetchProfilePosts: async () => [] }), // fetch succeeds, genuinely nothing this month
      },
    });
    const releaseEventSpy = vi.spyOn(deps.rateLimitStore, 'releaseEvent');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/nothing was published/i);
    expect(releaseEventSpy).not.toHaveBeenCalled();
  });

  it('still detects a true outage (503) even when a dangling connection_expired warning exists for an unconnected platform', async () => {
    // Regression: a connection_expired warning can be pushed for a
    // platform with no handle (so it's excluded from `connected`
    // entirely). If the outage check counted it, warnings.length would
    // outnumber connected.length and a real total outage would be missed.
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('youtube down'));
    const deps = makeDeps({
      youtubeClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: null, instagram: null }),
      getPlatformConnection: async (_profileId, platform) =>
        platform === 'tiktok' ? { status: 'connection_expired' as const } : { status: 'not_connected' as const },
    });
    const releaseEventSpy = vi.spyOn(deps.rateLimitStore, 'releaseEvent');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(503);
    expect(result.body.error).toMatch(/couldn't reach any of your connected platforms/i);
    expect(releaseEventSpy).toHaveBeenCalledTimes(1);
  });
});
