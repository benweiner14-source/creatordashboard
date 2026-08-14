import type { ProfilePost } from './scraper';
import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';

/**
 * TikTok OAuth endpoints verified against live documentation on 2026-08-14:
 * - https://developers.tiktok.com/doc/login-kit-web (authorize URL)
 * - https://developers.tiktok.com/doc/oauth-user-access-token-management (token URL)
 * - https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info (user info endpoint)
 * - https://developers.tiktok.com/doc/tiktok-api-v2-video-list (video list endpoint)
 */
const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';

// user.info.basic identifies the creator; video.list reads their own
// videos' stats — the two Display API scopes this feature needs.
// Verified against https://developers.tiktok.com/doc/tiktok-api-scopes on 2026-08-14.
const SCOPES = 'user.info.basic,video.list';

// Mirrors PROFILE_SCRAPE_RESULTS_LIMIT in lib/integrations/scraper.ts —
// see spec §4.
const PROFILE_POSTS_MAX_RESULTS = 50;

function parseExpiresAt(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

export function createTikTokOAuthClient(clientId: string, clientSecret: string): OAuthProviderClient {
  return {
    buildAuthorizeUrl(state: string, redirectUri: string): string {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_key', clientId);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet> {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) {
        throw new Error(`TikTok token exchange failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async getProviderUserId(accessToken: string): Promise<string> {
      const url = new URL(USER_INFO_URL);
      url.searchParams.set('fields', 'open_id');
      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`TikTok user info request failed with status ${response.status}`);
      }
      const data = await response.json();
      const openId = data.data?.user?.open_id;
      if (!openId) {
        throw new Error('TikTok user info response did not include open_id');
      }
      return openId;
    },

    async refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet> {
      if (!current.refreshToken) {
        throw new Error('No TikTok refresh token available to refresh with');
      }
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        }),
      });
      if (!response.ok) {
        throw new Error(`TikTok token refresh failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        // TikTok rotates the refresh token on every use — the new one
        // must replace the old one, never re-store the presented value.
        refreshToken: data.refresh_token ?? null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async fetchProfilePosts(accessToken: string): Promise<ProfilePost[]> {
      const url = new URL(VIDEO_LIST_URL);
      url.searchParams.set(
        'fields',
        'id,video_description,create_time,share_url,view_count,like_count,comment_count'
      );
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: PROFILE_POSTS_MAX_RESULTS }),
      });
      if (!response.ok) {
        throw new Error(`TikTok video list request failed with status ${response.status}`);
      }
      const data = await response.json();
      const videos: Array<Record<string, unknown>> = data.data?.videos ?? [];
      return videos.map((v) => ({
        platform: 'tiktok' as const,
        id: String(v.id),
        caption: String(v.video_description ?? ''),
        publishedAt: new Date(Number(v.create_time) * 1000).toISOString(),
        viewCount: Number(v.view_count ?? 0),
        likeCount: Number(v.like_count ?? 0),
        commentCount: Number(v.comment_count ?? 0),
        permalink: String(v.share_url ?? ''),
      }));
    },
  };
}
