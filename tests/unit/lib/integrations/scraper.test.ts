// tests/unit/lib/integrations/scraper.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectSocialPlatform, createApifyScraperClient, PlatformNotSupportedError } from '@/lib/integrations/scraper';

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

  it('maps TikTok authorMeta.fans to followerCount with no extra request', async () => {
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
          authorMeta: { fans: 48300 },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.tiktok.com/@user/video/12345');

    expect(post.followerCount).toBe(48300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches Instagram follower count via a second details call', async () => {
    const postScrapeResponse = {
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'abc123',
          shortCode: 'abc123',
          caption: 'A great reel',
          timestamp: '2026-08-01T10:00:00Z',
          videoViewCount: 34000,
          likesCount: 500,
          commentsCount: 12,
          ownerUsername: 'nba2k',
        },
      ],
    };
    const detailsResponse = {
      ok: true,
      status: 200,
      json: async () => [{ followersCount: 5400000 }],
    };
    const sequencedFetch = vi.fn()
      .mockResolvedValueOnce(postScrapeResponse)
      .mockResolvedValueOnce(detailsResponse);
    vi.stubGlobal('fetch', sequencedFetch);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.instagram.com/reel/abc123/');

    expect(post.followerCount).toBe(5400000);
    expect(sequencedFetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(sequencedFetch.mock.calls[1][1].body);
    expect(secondCallBody).toEqual({ resultsType: 'details', directUrls: ['https://www.instagram.com/nba2k/'] });
  });

  it('omits followerCount (not throwing) when the Instagram details call fails', async () => {
    const postScrapeResponse = {
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'abc123',
          caption: 'A great reel',
          timestamp: '2026-08-01T10:00:00Z',
          videoViewCount: 34000,
          likesCount: 500,
          commentsCount: 12,
          ownerUsername: 'nba2k',
        },
      ],
    };
    const failedDetailsResponse = { ok: false, status: 500 };
    const sequencedFetch = vi.fn()
      .mockResolvedValueOnce(postScrapeResponse)
      .mockResolvedValueOnce(failedDetailsResponse);
    vi.stubGlobal('fetch', sequencedFetch);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.instagram.com/reel/abc123/');

    expect(post.followerCount).toBeUndefined();
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
          durationSeconds: undefined,
          followerCount: undefined,
          permalink: 'https://www.tiktok.com/@creator/video/111',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/acts/clockworks~tiktok-scraper/runs');
      expect(String(fetchMock.mock.calls[1][0])).toContain('/actor-runs/run-1');
      expect(String(fetchMock.mock.calls[3][0])).toContain('/datasets/dataset-1/items');
    });

    it('includes durationSeconds when the Apify item has a videoDuration field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '222',
              text: 'Post two',
              createTimeISO: '2026-08-03T10:00:00Z',
              videoDuration: 45,
              playCount: 2000,
              diggCount: 90,
              commentCount: 8,
              webVideoUrl: 'https://www.tiktok.com/@creator/video/222',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts[0].durationSeconds).toBe(45);
    });

    describe('fetchProfilePosts follower count', () => {
      it('extracts followerCount from authorMeta.fans for TikTok', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              {
                id: '1',
                text: 'Post',
                createTimeISO: '2026-08-01T00:00:00Z',
                playCount: 100,
                diggCount: 5,
                commentCount: 1,
                authorMeta: { fans: 42000 },
                webVideoUrl: 'https://www.tiktok.com/@creator/video/1',
              },
            ],
          });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('tiktok', 'creator');

        expect(posts[0].followerCount).toBe(42000);
      });

      it('extracts followerCount from followersCount for Instagram', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              {
                id: '1',
                caption: 'Post',
                timestamp: '2026-08-01T00:00:00Z',
                viewCount: 100,
                likesCount: 5,
                commentCount: 1,
                followersCount: 8000,
                url: 'https://www.instagram.com/p/1/',
              },
            ],
          });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('instagram', 'creator');

        expect(posts[0].followerCount).toBe(8000);
      });

      it('falls back to a details-scrape call for Instagram when includeFollowerCount is set and no item carried one', async () => {
        // Confirmed live (2026-09-18): a resultsType:"posts" Instagram scrape
        // never includes followersCount on any item, unlike TikTok's
        // authorMeta.fans -- this is the fetchPost/fetchInstagramFollowerCount
        // fallback, now also available to fetchProfilePosts callers who ask
        // for it (Watchlist), without changing the default (cheaper) behavior
        // for callers who don't (Strategy Breakdown, Recap Card).
        const fetchMock = vi
          .fn()
          // start run
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          // poll: succeeded
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          // dataset items -- no followersCount on either item
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              { id: '1', caption: 'Post 1', timestamp: '2026-08-01T00:00:00Z', viewCount: 100, likesCount: 5, commentCount: 1, url: 'https://www.instagram.com/p/1/' },
              { id: '2', caption: 'Post 2', timestamp: '2026-08-02T00:00:00Z', viewCount: 200, likesCount: 6, commentCount: 2, url: 'https://www.instagram.com/p/2/' },
            ],
          })
          // the extra details-scrape fallback call
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ followersCount: 55000 }] });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('instagram', 'creator', { includeFollowerCount: true });

        expect(posts[0].followerCount).toBe(55000);
        expect(posts[1].followerCount).toBe(55000);
        expect(String(fetchMock.mock.calls[3][1].body)).toContain('"resultsType":"details"');
      });

      it('does not make the extra details-scrape call when includeFollowerCount is not set', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [{ id: '1', caption: 'Post 1', timestamp: '2026-08-01T00:00:00Z', viewCount: 100, likesCount: 5, commentCount: 1 }],
          });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('instagram', 'creator');

        expect(posts[0].followerCount).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      it('does not make the extra details-scrape call for TikTok even with includeFollowerCount set, since authorMeta.fans is already reliable', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              { id: '1', text: 'Post', createTimeISO: '2026-08-01T00:00:00Z', playCount: 100, diggCount: 5, commentCount: 1, authorMeta: { fans: 42000 } },
            ],
          });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('tiktok', 'creator', { includeFollowerCount: true });

        expect(posts[0].followerCount).toBe(42000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      it('leaves followerCount undefined when the details-scrape fallback also fails', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [{ id: '1', caption: 'Post 1', timestamp: '2026-08-01T00:00:00Z', viewCount: 100, likesCount: 5, commentCount: 1 }],
          })
          .mockResolvedValueOnce({ ok: false, status: 500 });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('instagram', 'creator', { includeFollowerCount: true });

        expect(posts[0].followerCount).toBeUndefined();
      });

      it('leaves followerCount undefined when the actor run did not include one', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
          .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [{ id: '1', text: 'Post', createTimeISO: '2026-08-01T00:00:00Z', playCount: 100, diggCount: 5, commentCount: 1 }],
          });
        vi.stubGlobal('fetch', fetchMock);

        const client = createApifyScraperClient('test-token', { sleep: async () => {} });
        const posts = await client.fetchProfilePosts('tiktok', 'creator');

        expect(posts[0].followerCount).toBeUndefined();
      });
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

  describe('fetchVideoForAnalysis', () => {
    it('fetches a downloadable video, duration, and transcript for TikTok', async () => {
      const scrapeResponse = {
        ok: true,
        status: 200,
        json: async () => [
          {
            mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4'],
            videoMeta: {
              duration: 50.534,
              transcriptionLink: 'https://api.apify.com/v2/key-value-stores/xyz/records/transcription-123.txt',
            },
          },
        ],
      };
      const transcriptResponse = { ok: true, text: async () => 'You can actually play GTA 6 early.' };
      const sequencedFetch = vi.fn()
        .mockResolvedValueOnce(scrapeResponse)
        .mockResolvedValueOnce(transcriptResponse);
      vi.stubGlobal('fetch', sequencedFetch);

      const client = createApifyScraperClient('test-token');
      const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

      expect(new URL(video.videoUrl).searchParams.get('token')).toBe('test-token');
      expect(new URL(video.videoUrl).origin + new URL(video.videoUrl).pathname).toBe(
        'https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4'
      );
      expect(video.durationSeconds).toBe(50.534);
      expect(video.transcript).toBe('You can actually play GTA 6 early.');

      const firstCallBody = JSON.parse(sequencedFetch.mock.calls[0][1].body as string);
      expect(firstCallBody).toEqual({
        postURLs: ['https://www.tiktok.com/@user/video/123'],
        shouldDownloadVideos: true,
        downloadSubtitlesOptions: 'TRANSCRIBE_ALL_VIDEOS',
      });
      const transcriptUrl = new URL(sequencedFetch.mock.calls[1][0] as string);
      expect(transcriptUrl.pathname).toContain('transcription-123.txt');
      expect(transcriptUrl.searchParams.get('token')).toBe('test-token');
    });

    it('does not append the Apify token to the TikTok CDN fallback URL', async () => {
      const cdnUrl = 'https://v16-webapp.tiktok.com/video/tos/useast/abc/?a=1988&br=3000&expire=123';
      const scrapeResponse = {
        ok: true,
        status: 200,
        json: async () => [{ videoMeta: { duration: 30, downloadAddr: cdnUrl } }],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

      const client = createApifyScraperClient('test-token');
      const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

      // The token must never reach a third-party host's access logs, and the
      // pre-existing query string must survive intact.
      expect(video.videoUrl).toBe(cdnUrl);
      expect(video.videoUrl).not.toContain('test-token');
      expect(new URL(video.videoUrl).searchParams.get('a')).toBe('1988');
    });

    it('appends the token without a double-? when the Apify media URL already has a query string', async () => {
      const scrapeResponse = {
        ok: true,
        status: 200,
        json: async () => [
          {
            mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4?disableRedirect=true'],
            videoMeta: { duration: 30 },
          },
        ],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

      const client = createApifyScraperClient('test-token');
      const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

      expect(video.videoUrl.match(/\?/g)).toHaveLength(1);
      const parsed = new URL(video.videoUrl);
      expect(parsed.searchParams.get('token')).toBe('test-token');
      expect(parsed.searchParams.get('disableRedirect')).toBe('true');
    });

    it('returns a null transcript (not throwing) when transcriptionLink is missing', async () => {
      const scrapeResponse = {
        ok: true,
        status: 200,
        json: async () => [{ mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4'], videoMeta: { duration: 30 } }],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

      const client = createApifyScraperClient('test-token');
      const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

      expect(video.transcript).toBeNull();
    });

    it('throws when no downloadable video is present in the response', async () => {
      const scrapeResponse = { ok: true, status: 200, json: async () => [{ videoMeta: { duration: 30 } }] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

      const client = createApifyScraperClient('test-token');
      await expect(client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123')).rejects.toThrow(
        'No downloadable video found'
      );
    });

    it('throws PlatformNotSupportedError for instagram, without making any request', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token');
      await expect(
        client.fetchVideoForAnalysis('instagram', 'https://www.instagram.com/reel/abc123/')
      ).rejects.toThrow(PlatformNotSupportedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('fetchComments', () => {
    it('fetches TikTok comments via the dedicated comments actor, sorted by like count descending', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { text: 'Best use of Ai', diggCount: 26061 },
          { text: 'GTA needs a movie', diggCount: 41752 },
          { text: 'meh', diggCount: 3 },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('tiktok', 'https://www.tiktok.com/@user/video/123', 15);

      expect(comments).toEqual([
        { text: 'GTA needs a movie', likeCount: 41752 },
        { text: 'Best use of Ai', likeCount: 26061 },
        { text: 'meh', likeCount: 3 },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/acts/clockworks~tiktok-comments-scraper/');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.postURLs).toEqual(['https://www.tiktok.com/@user/video/123']);
      expect(body.commentsPerPost).toBe(15);
      expect(body.maxRepliesPerComment).toBe(0);
    });

    it('fetches Instagram comments from the same posts-scrape actor fetchPost already uses, sorted by like count descending', async () => {
      // latestComments is named for recency, not popularity -- confirmed live
      // (2026-09-18) that Instagram returns it in chronological order, not
      // sorted by likesCount, so this must re-sort explicitly rather than
      // trusting the actor's own order.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            shortCode: 'ABC',
            latestComments: [
              { text: 'meh', likesCount: 0 },
              { text: 'Amazing!', likesCount: 33 },
              { text: 'nice', likesCount: 1 },
            ],
          },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('instagram', 'https://www.instagram.com/p/ABC/', 15);

      expect(comments).toEqual([
        { text: 'Amazing!', likeCount: 33 },
        { text: 'nice', likeCount: 1 },
        { text: 'meh', likeCount: 0 },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/acts/apify~instagram-scraper/');
    });

    it('truncates to the requested limit after sorting', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { text: 'a', diggCount: 1 },
          { text: 'b', diggCount: 5 },
          { text: 'c', diggCount: 3 },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('tiktok', 'https://www.tiktok.com/@user/video/123', 2);

      expect(comments).toEqual([
        { text: 'b', likeCount: 5 },
        { text: 'c', likeCount: 3 },
      ]);
    });

    it('returns an empty array when the post has no comments', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('tiktok', 'https://www.tiktok.com/@user/video/123', 15);

      expect(comments).toEqual([]);
    });

    it('returns an empty array for an Instagram post with no latestComments field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ shortCode: 'ABC' }] })
      );

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('instagram', 'https://www.instagram.com/p/ABC/', 15);

      expect(comments).toEqual([]);
    });

    it('skips comments with empty/missing text', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { text: '', diggCount: 100 },
          { diggCount: 50 },
          { text: 'real comment', diggCount: 10 },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token');
      const comments = await client.fetchComments('tiktok', 'https://www.tiktok.com/@user/video/123', 15);

      expect(comments).toEqual([{ text: 'real comment', likeCount: 10 }]);
    });

    it('throws when the Apify request itself responds with a non-2xx status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const client = createApifyScraperClient('test-token');
      await expect(client.fetchComments('tiktok', 'https://www.tiktok.com/@user/video/123', 15)).rejects.toThrow();
    });
  });
});
