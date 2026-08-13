import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractYouTubeVideoId, createYouTubeClient } from '@/lib/integrations/youtube';

describe('extractYouTubeVideoId', () => {
  it('extracts the video id from a standard watch URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the video id from a youtu.be short URL', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the video id from a Shorts URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractYouTubeVideoId('https://example.com/video')).toBeNull();
  });
});

describe('createYouTubeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes video metadata from the YouTube Data API', async () => {
    const fakeResponse = {
      items: [
        {
          snippet: {
            title: 'How I grew to 10k subscribers',
            description: 'A breakdown of my strategy',
            publishedAt: '2026-07-01T14:00:00Z',
            tags: ['creator', 'growth'],
          },
          statistics: { viewCount: '15000', likeCount: '900', commentCount: '120' },
          contentDetails: { duration: 'PT4M32S' },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fakeResponse });
    vi.stubGlobal('fetch', fetchMock);

    const client = createYouTubeClient('test-api-key');
    const metadata = await client.getVideoMetadata('dQw4w9WgXcQ');

    expect(metadata).toEqual({
      id: 'dQw4w9WgXcQ',
      title: 'How I grew to 10k subscribers',
      description: 'A breakdown of my strategy',
      publishedAt: '2026-07-01T14:00:00Z',
      durationSeconds: 272,
      viewCount: 15000,
      likeCount: 900,
      commentCount: 120,
      tags: ['creator', 'growth'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('videos');
  });

  it('throws when the API returns no matching video', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
    const client = createYouTubeClient('test-api-key');
    await expect(client.getVideoMetadata('missing-id')).rejects.toThrow('No YouTube video found');
  });

  describe('getChannelUploads', () => {
    it('resolves the uploads playlist by handle, then fetches and normalizes recent videos', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUuploads1' } } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { videoId: 'vid1' } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                snippet: { title: 'Video one', description: '', publishedAt: '2026-08-03T00:00:00Z', tags: [] },
                statistics: { viewCount: '2000', likeCount: '150', commentCount: '20' },
                contentDetails: { duration: 'PT1M' },
              },
            ],
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createYouTubeClient('test-api-key');
      const videos = await client.getChannelUploads('@creator');

      expect(videos).toEqual([
        {
          id: 'vid1',
          title: 'Video one',
          description: '',
          publishedAt: '2026-08-03T00:00:00Z',
          durationSeconds: 60,
          viewCount: 2000,
          likeCount: 150,
          commentCount: 20,
          tags: [],
        },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain('forHandle=%40creator');
      expect(String(fetchMock.mock.calls[1][0])).toContain('playlistId=UUuploads1');
    });

    it('throws when no channel is found for the handle', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
      const client = createYouTubeClient('test-api-key');
      await expect(client.getChannelUploads('missing-handle')).rejects.toThrow('No YouTube channel found');
    });

    it('returns an empty array when the channel has no uploads', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUuploads1' } } }] }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
      vi.stubGlobal('fetch', fetchMock);

      const client = createYouTubeClient('test-api-key');
      const videos = await client.getChannelUploads('@creator');
      expect(videos).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
