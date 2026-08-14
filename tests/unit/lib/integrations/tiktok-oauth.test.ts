import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { OAuthRefreshInvalidError } from '@/lib/oauth/types';

describe('createTikTokOAuthClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an authorize URL with the client key, scope, redirect_uri, and state', () => {
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const url = new URL(client.buildAuthorizeUrl('nonce-123', 'https://app.example.com/api/oauth/tiktok/callback'));
    expect(url.hostname).toBe('www.tiktok.com');
    expect(url.searchParams.get('client_key')).toBe('test-client-id');
    expect(url.searchParams.get('state')).toBe('nonce-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/oauth/tiktok/callback');
    expect(url.searchParams.get('scope')).toContain('user.info.basic');
  });

  it('exchanges a code for a token set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const before = Date.now();
    const tokenSet = await client.exchangeCode('auth-code', 'https://app.example.com/api/oauth/tiktok/callback');

    expect(tokenSet.accessToken).toBe('access-1');
    expect(tokenSet.refreshToken).toBe('refresh-1');
    expect(tokenSet.expiresAt).not.toBeNull();
    expect(tokenSet.expiresAt!.getTime()).toBeGreaterThan(before);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(String(options.body)).toContain('code=auth-code');
  });

  it('throws when the token exchange request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.exchangeCode('bad-code', 'https://app.example.com/callback')).rejects.toThrow('status 400');
  });

  it('fetches the provider user id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: 'user-open-id-1' } } }) })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const userId = await client.getProviderUserId('access-1');
    expect(userId).toBe('user-open-id-1');
  });

  it('throws when the user info response has a body-level error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: 'access_token_invalid', message: 'x', log_id: 'y' } }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.getProviderUserId('access-1')).rejects.toThrow('access_token_invalid');
  });

  it('throws OAuthRefreshInvalidError when there is no refresh token to refresh with', async () => {
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const promise = client.refreshAccessToken({ accessToken: 'a', refreshToken: null, expiresAt: null });
    await expect(promise).rejects.toThrow('No TikTok refresh token');
    await expect(client.refreshAccessToken({ accessToken: 'a', refreshToken: null, expiresAt: null })).rejects.toBeInstanceOf(
      OAuthRefreshInvalidError
    );
  });

  it('refreshes an access token, returning the rotated refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86400 }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const refreshed = await client.refreshAccessToken({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null });
    expect(refreshed.accessToken).toBe('access-2');
    expect(refreshed.refreshToken).toBe('refresh-2');
  });

  it('throws OAuthRefreshInvalidError when the refresh request is rejected with a 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(
      client.refreshAccessToken({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null })
    ).rejects.toBeInstanceOf(OAuthRefreshInvalidError);
  });

  it('fetches and normalizes profile posts into the shared ProfilePost shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            videos: [
              {
                id: '7000000000000000001',
                video_description: 'Day 1 of posting every day',
                create_time: 1755100800,
                share_url: 'https://www.tiktok.com/@creator/video/7000000000000000001',
                view_count: 12000,
                like_count: 900,
                comment_count: 60,
              },
            ],
          },
        }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');
    expect(posts).toEqual([
      {
        platform: 'tiktok',
        id: '7000000000000000001',
        caption: 'Day 1 of posting every day',
        publishedAt: new Date(1755100800 * 1000).toISOString(),
        viewCount: 12000,
        likeCount: 900,
        commentCount: 60,
        permalink: 'https://www.tiktok.com/@creator/video/7000000000000000001',
      },
    ]);
  });

  it('paginates at 20 per page until has_more is false, accumulating posts across pages', async () => {
    const makeVideo = (id: string) => ({
      id,
      video_description: `post ${id}`,
      create_time: 1755100800,
      share_url: `https://www.tiktok.com/@creator/video/${id}`,
      view_count: 100,
      like_count: 10,
      comment_count: 1,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { videos: [makeVideo('1'), makeVideo('2')], cursor: 999, has_more: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { videos: [makeVideo('3')], has_more: false } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(posts.map((p) => p.id)).toEqual(['1', '2', '3']);
    const [, secondCallOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(secondCallOptions.body))).toMatchObject({ cursor: 999 });
  });

  it('stops after a bounded number of pages even if has_more never turns false', async () => {
    // A page that keeps reporting has_more: true (a misbehaving API, or a
    // cursor that never advances) must not hang the request forever.
    const makeVideo = (id: string) => ({
      id,
      video_description: `post ${id}`,
      create_time: 1755100800,
      share_url: `https://www.tiktok.com/@creator/video/${id}`,
      view_count: 100,
      like_count: 10,
      comment_count: 1,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { videos: [makeVideo('x')], cursor: 1, has_more: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');

    // 50-post cap / 20-per-page = 3 pages max, regardless of has_more.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(posts.length).toBe(3);
  });

  it('throws when the video list response has a body-level error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: 'access_token_invalid', message: 'x', log_id: 'y' } }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.fetchProfilePosts('access-1')).rejects.toThrow('access_token_invalid');
  });

  it('best-effort revokes the token on the documented revoke endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await client.revokeToken!('access-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/revoke/');
    expect(String(options.body)).toContain('token=access-1');
  });

  it('throws when the revoke request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.revokeToken!('access-1')).rejects.toThrow('status 500');
  });
});
