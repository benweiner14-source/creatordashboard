// tests/unit/lib/integrations/scraper.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectSocialPlatform, createApifyScraperClient } from '@/lib/integrations/scraper';

describe('detectSocialPlatform', () => {
  it('detects TikTok URLs', () => {
    expect(detectSocialPlatform('https://www.tiktok.com/@user/video/12345')).toBe('tiktok');
  });

  it('detects Instagram URLs', () => {
    expect(detectSocialPlatform('https://www.instagram.com/reel/abc123/')).toBe('instagram');
  });

  it('returns null for unrelated URLs', () => {
    expect(detectSocialPlatform('https://example.com')).toBeNull();
  });
});

describe('createApifyScraperClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes a TikTok post via the Apify dataset API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '12345',
          text: 'Day 1 of posting every day #creator',
          createTimeISO: '2026-08-01T10:00:00Z',
          videoDuration: 32,
          playCount: 20000,
          diggCount: 1500,
          commentCount: 80,
          shareCount: 45,
          collectCount: 30,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.tiktok.com/@user/video/12345');

    expect(post).toEqual({
      platform: 'tiktok',
      id: '12345',
      caption: 'Day 1 of posting every day #creator',
      publishedAt: '2026-08-01T10:00:00Z',
      durationSeconds: 32,
      viewCount: 20000,
      likeCount: 1500,
      commentCount: 80,
      shareCount: 45,
      saveCount: 30,
    });
  });

  it('maps shareCount/saveCount to undefined when Apify does not include them (e.g. Instagram)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'abc123',
          caption: 'A reel',
          timestamp: '2026-08-01T10:00:00Z',
          duration: 20,
          videoViewCount: 5000,
          likesCount: 300,
          commentCount: 50,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.instagram.com/reel/abc123/');

    expect(post.shareCount).toBeUndefined();
    expect(post.saveCount).toBeUndefined();
  });

  it('throws for an unsupported URL', async () => {
    const client = createApifyScraperClient('test-token');
    await expect(client.fetchPost('https://example.com/x')).rejects.toThrow('Unsupported social URL');
  });

  describe('fetchProfilePosts', () => {
    it('starts an async Apify run, polls until it succeeds, and normalizes the dataset items', async () => {
      const fetchMock = vi
        .fn()
        // start run
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }),
        })
        // poll: still running
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'RUNNING' } }) })
        // poll: succeeded
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        // dataset items
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '111',
              text: 'Post one',
              createTimeISO: '2026-08-02T10:00:00Z',
              playCount: 1000,
              diggCount: 50,
              commentCount: 5,
              webVideoUrl: 'https://www.tiktok.com/@creator/video/111',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts).toEqual([
        {
          platform: 'tiktok',
          id: '111',
          caption: 'Post one',
          publishedAt: '2026-08-02T10:00:00Z',
          viewCount: 1000,
          likeCount: 50,
          commentCount: 5,
          permalink: 'https://www.tiktok.com/@creator/video/111',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/acts/clockworks~tiktok-scraper/runs');
      expect(String(fetchMock.mock.calls[1][0])).toContain('/actor-runs/run-1');
      expect(String(fetchMock.mock.calls[3][0])).toContain('/datasets/dataset-1/items');
    });

    it('retries once after a failed run and succeeds on the second attempt', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'FAILED' } }) })
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-2', defaultDatasetId: 'dataset-2' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {}, retryAttempts: 1 });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws after exhausting all retry attempts', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {}, retryAttempts: 1 });
      await expect(client.fetchProfilePosts('instagram', 'creator')).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
