import { describe, it, expect, vi } from 'vitest';
import { handleRecapRequest, RECAP_GENERATION_PROFILE_LIMIT } from '@/lib/recap/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import type { RecapCardRow, RecapHandles } from '@/lib/recap/types';
import type { RecapHandlerDeps } from '@/lib/recap/handler';

function makeDeps(overrides: Partial<Parameters<typeof handleRecapRequest>[0]> = {}): RecapHandlerDeps {
  const savedCards: RecapCardRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    ipSalt: 'test-salt',
    getProfileHandles: async (): Promise<RecapHandles> => ({ youtube: 'creator', tiktok: null, instagram: null }),
    getExistingRecapCard: async () => null,
    saveRecapCard: async (params) => {
      const row: RecapCardRow = { id: `card-${savedCards.length + 1}`, profileId: params.profileId, month: params.month, platformData: params.platformData, totals: params.totals, topPost: params.topPost, warnings: params.warnings, generatedAt: '2026-08-13T00:00:00Z' };
      savedCards.push(row);
      return row;
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
          durationSeconds: 60, viewCount: 3000, likeCount: 200, commentCount: 10, tags: [],
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
});
