import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6Videos, normalizeYoutubeVideo } from '@/lib/warroom/discovery/youtube';

describe('normalizeYoutubeVideo', () => {
  it('maps a YouTube videos.list item to a DiscoveredPost', () => {
    const result = normalizeYoutubeVideo({
      id: 'abc123',
      snippet: { title: 'GTA 6 trailer breakdown', publishedAt: '2026-09-15T10:00:00Z' },
      statistics: { viewCount: '5000', likeCount: '400', commentCount: '50' },
    });
    expect(result).toEqual({
      platform: 'youtube',
      externalPostId: 'abc123',
      url: 'https://www.youtube.com/watch?v=abc123',
      captionOrTitle: 'GTA 6 trailer breakdown',
      viewCount: 5000,
      engagementCount: 450,
      publishedAt: '2026-09-15T10:00:00Z',
    });
  });

  it('defaults missing statistics fields to 0 rather than NaN', () => {
    const result = normalizeYoutubeVideo({
      id: 'abc123',
      snippet: { title: 'x', publishedAt: '2026-09-15T10:00:00Z' },
      statistics: {},
    });
    expect(result.viewCount).toBe(0);
    expect(result.engagementCount).toBe(0);
  });
});

describe('searchGta6Videos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls search.list then videos.list and returns normalized posts with no errors', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [{ id: { videoId: 'v1' } }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'v1',
              snippet: { title: 'GTA 6 news', publishedAt: '2026-09-15T10:00:00Z' },
              statistics: { viewCount: '100', likeCount: '10', commentCount: '2' },
            },
          ],
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGta6Videos('test-key', new Date('2026-09-15T00:00:00Z'));

    expect(result.errors).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].externalPostId).toBe('v1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns no posts and does not call videos.list when search.list finds nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGta6Videos('test-key', new Date('2026-09-15T00:00:00Z'));

    expect(result.posts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when search.list responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(searchGta6Videos('test-key', new Date())).rejects.toThrow('status 403');
  });

  it('throws when videos.list responds with a non-2xx status', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [{ id: { videoId: 'v1' } }] }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchGta6Videos('test-key', new Date())).rejects.toThrow(
      /videos\.list.*status 500/
    );
  });
});
