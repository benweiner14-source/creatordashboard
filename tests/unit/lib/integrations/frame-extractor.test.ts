import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createApifyFrameExtractorClient,
  fetchImageAsBase64,
  HOOK_WINDOW_TIMESTAMPS_SECONDS,
} from '@/lib/integrations/frame-extractor';

describe('HOOK_WINDOW_TIMESTAMPS_SECONDS', () => {
  it('samples the first 5 seconds once per second, to stay inside the 60s function budget', () => {
    expect(HOOK_WINDOW_TIMESTAMPS_SECONDS).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('createApifyFrameExtractorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends videoUrls as {url} objects and lowercase outputFormat, filters to succeeded frames', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { status: 'succeeded', timestampSeconds: 0, storedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-0.jpg' },
        { status: 'failed', timestampSeconds: 0.5 },
        { status: 'succeeded', timestampSeconds: 1, storedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-1.jpg' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyFrameExtractorClient('test-token');
    const frames = await client.extractFrames('https://example.com/video.mp4', [0, 0.5, 1]);

    expect(frames.map((f) => f.timestampSeconds)).toEqual([0, 1]);
    frames.forEach((frame) => {
      expect(new URL(frame.imageUrl).searchParams.get('token')).toBe('test-token');
    });
    expect(new URL(frames[0].imageUrl).pathname).toContain('frame-0.jpg');
    expect(new URL(frames[1].imageUrl).pathname).toContain('frame-1.jpg');

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.videoUrls).toEqual([{ url: 'https://example.com/video.mp4' }]);
    expect(requestBody.outputFormat).toBe('jpeg');
    expect(requestBody.timestampSeconds).toEqual([0, 0.5, 1]);
  });

  it('appends the token without a double-? when the stored file URL already has a query string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            status: 'succeeded',
            timestampSeconds: 0,
            storedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-0.jpg?disableRedirect=true',
          },
        ],
      })
    );

    const client = createApifyFrameExtractorClient('test-token');
    const frames = await client.extractFrames('https://example.com/video.mp4', [0]);

    expect(frames[0].imageUrl.match(/\?/g)).toHaveLength(1);
    const parsed = new URL(frames[0].imageUrl);
    expect(parsed.searchParams.get('token')).toBe('test-token');
    expect(parsed.searchParams.get('disableRedirect')).toBe('true');
  });

  it('throws when the actor call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createApifyFrameExtractorClient('test-token');
    await expect(client.extractFrames('https://example.com/video.mp4', [0])).rejects.toThrow('400');
  });
});

describe('fetchImageAsBase64', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and base64-encodes an image', async () => {
    const fakeBytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => fakeBytes.buffer }));

    const result = await fetchImageAsBase64('https://example.com/frame.jpg');

    expect(result).toBe(Buffer.from(fakeBytes).toString('base64'));
  });

  it('throws when the image fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchImageAsBase64('https://example.com/frame.jpg')).rejects.toThrow('404');
  });
});
