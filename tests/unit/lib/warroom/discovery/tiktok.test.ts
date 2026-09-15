import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6TikToks, normalizeTikTokPost } from '@/lib/warroom/discovery/tiktok';

describe('normalizeTikTokPost', () => {
  it('maps a raw TikTok scraper item to a DiscoveredPost', () => {
    const result = normalizeTikTokPost({
      id: '123',
      playCount: 50000,
      diggCount: 4000,
      commentCount: 100,
      shareCount: 200,
      text: 'GTA 6 gameplay leak?!',
      webVideoUrl: 'https://www.tiktok.com/@someone/video/123',
      authorMeta: { uniqueId: 'someone' },
      createTime: 1757930400, // 2025-09-15T10:00:00Z
    });
    expect(result).toEqual({
      platform: 'tiktok',
      externalPostId: '123',
      url: 'https://www.tiktok.com/@someone/video/123',
      captionOrTitle: 'GTA 6 gameplay leak?!',
      viewCount: 50000,
      engagementCount: 4300,
      publishedAt: new Date(1757930400 * 1000).toISOString(),
    });
  });

  it('returns null for an item missing an id or createTime', () => {
    expect(normalizeTikTokPost({ playCount: 100 })).toBeNull();
  });
});

describe('searchGta6TikToks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalized posts and skips benign error items without reporting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', playCount: 100, diggCount: 10, commentCount: 1, createTime: 1757930400, authorMeta: { uniqueId: 'a' } },
          { error: 'not_found' },
        ],
      })
    );

    const result = await searchGta6TikToks('test-token');

    expect(result.posts).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a non-benign error item without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ error: 'Apify hard limit exceeded for this month' }],
      })
    );

    const result = await searchGta6TikToks('test-token');

    expect(result.posts).toEqual([]);
    expect(result.errors).toEqual(['Apify hard limit exceeded for this month']);
  });

  it('throws when the Apify request itself responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(searchGta6TikToks('test-token')).rejects.toThrow('status 500');
  });
});
