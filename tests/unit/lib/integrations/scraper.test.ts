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
});
