import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';

describe('createInstagramOAuthClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an authorize URL with the client id, scope, redirect_uri, and state', () => {
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const url = new URL(client.buildAuthorizeUrl('nonce-123', 'https://app.example.com/api/oauth/instagram/callback'));
    expect(url.hostname).toBe('api.instagram.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('state')).toBe('nonce-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/oauth/instagram/callback');
  });

  it('exchanges a code for a short-lived token, then exchanges that for a long-lived token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'short-lived-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'long-lived-1', expires_in: 5184000 }), // ~60 days
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const before = Date.now();
    const tokenSet = await client.exchangeCode('auth-code', 'https://app.example.com/api/oauth/instagram/callback');

    expect(tokenSet.accessToken).toBe('long-lived-1');
    expect(tokenSet.refreshToken).toBeNull();
    expect(tokenSet.expiresAt!.getTime()).toBeGreaterThan(before);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondCallUrl.searchParams.get('access_token')).toBe('short-lived-1');
    expect(secondCallUrl.searchParams.get('grant_type')).toBe('ig_exchange_token');
  });

  it('throws when the short-lived token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.exchangeCode('bad-code', 'https://app.example.com/callback')).rejects.toThrow(
      'Instagram token exchange failed'
    );
  });

  it('fetches the provider user id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user_id: 'ig-user-1' }) }));
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const userId = await client.getProviderUserId('access-1');
    expect(userId).toBe('ig-user-1');
  });

  it('refreshes a long-lived access token by presenting itself, with no separate refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'refreshed-1', expires_in: 5184000 }) })
    );
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const refreshed = await client.refreshAccessToken({ accessToken: 'current-token', refreshToken: null, expiresAt: null });
    expect(refreshed.accessToken).toBe('refreshed-1');
    expect(refreshed.refreshToken).toBeNull();
  });

  it('fetches and normalizes profile posts, with viewCount always 0 (known API limitation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: '17900000000000001',
              caption: 'New drop today',
              timestamp: '2026-08-06T10:00:00+0000',
              like_count: 500,
              comments_count: 20,
              permalink: 'https://www.instagram.com/p/abc123/',
            },
          ],
        }),
      })
    );
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');
    expect(posts).toEqual([
      {
        platform: 'instagram',
        id: '17900000000000001',
        caption: 'New drop today',
        publishedAt: '2026-08-06T10:00:00+0000',
        viewCount: 0,
        likeCount: 500,
        commentCount: 20,
        permalink: 'https://www.instagram.com/p/abc123/',
      },
    ]);
  });
});
