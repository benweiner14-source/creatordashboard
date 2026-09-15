import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6InstagramPosts, normalizeInstagramPost } from '@/lib/warroom/discovery/instagram';

describe('normalizeInstagramPost', () => {
  it('maps a raw Instagram hashtag-scraper item to a DiscoveredPost', () => {
    const result = normalizeInstagramPost({
      shortCode: 'ABC123',
      likesCount: 5000,
      commentsCount: 300,
      videoViewCount: 40000,
      url: 'https://www.instagram.com/p/ABC123/',
      caption: 'GTA 6 leak??',
      timestamp: '2026-09-15T10:00:00.000Z',
      ownerUsername: 'someone',
    });
    expect(result).toEqual({
      platform: 'instagram',
      externalPostId: 'ABC123',
      url: 'https://www.instagram.com/p/ABC123/',
      captionOrTitle: 'GTA 6 leak??',
      viewCount: 40000,
      engagementCount: 5300,
      publishedAt: '2026-09-15T10:00:00.000Z',
    });
  });

  it('falls back to a constructed url and a numeric unix timestamp field', () => {
    const result = normalizeInstagramPost({
      shortCode: 'XYZ',
      likesCount: 10,
      commentsCount: 1,
      takenAtTimestamp: 1757930400,
    });
    expect(result?.url).toBe('https://www.instagram.com/p/XYZ/');
    expect(result?.publishedAt).toBe(new Date(1757930400 * 1000).toISOString());
  });

  it('returns null for an item missing a shortCode/id or any timestamp', () => {
    expect(normalizeInstagramPost({ likesCount: 10 })).toBeNull();
  });

  it('falls back from shortCode to id for externalPostId', () => {
    const result = normalizeInstagramPost({
      id: 'DEF456',
      likesCount: 10,
      commentsCount: 1,
      timestamp: '2026-09-15T10:00:00.000Z',
    });
    expect(result?.externalPostId).toBe('DEF456');
  });

  it('returns null when shortCode/id is present but both timestamp fields are missing', () => {
    expect(normalizeInstagramPost({ shortCode: 'ABC123', likesCount: 10 })).toBeNull();
  });

  it('returns null when both id/shortCode are missing but timestamp is present', () => {
    expect(normalizeInstagramPost({ timestamp: '2026-09-15T10:00:00.000Z', likesCount: 10 })).toBeNull();
  });
});

describe('searchGta6InstagramPosts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalized posts and skips benign error items without reporting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { shortCode: 'A', likesCount: 10, commentsCount: 1, timestamp: '2026-09-15T10:00:00Z' },
          { error: 'restricted_page' },
        ],
      })
    );

    const result = await searchGta6InstagramPosts('test-token');

    expect(result.posts).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a non-benign error item without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ error: 'monthly usage limit reached' }] })
    );

    const result = await searchGta6InstagramPosts('test-token');

    expect(result.posts).toEqual([]);
    expect(result.errors).toEqual(['monthly usage limit reached']);
  });

  it('throws when the Apify request itself responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
    await expect(searchGta6InstagramPosts('test-token')).rejects.toThrow('status 429');
  });

  it('includes the response body in the thrown error so budget-exceeded detection can match it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        text: async () => 'Actor run failed: monthly usage hard limit exceeded',
      })
    );
    await expect(searchGta6InstagramPosts('test-token')).rejects.toThrow(/monthly usage hard limit exceeded/);
  });

  it('returns no posts when a 200 response body is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'something' }) }));
    await expect(searchGta6InstagramPosts('test-token')).resolves.toEqual({ posts: [], errors: [] });
  });
});
