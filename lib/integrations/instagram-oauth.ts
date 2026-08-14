import type { ProfilePost } from './scraper';
import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';

// OAuth endpoint URLs: Instagram login uses separate endpoints at api.instagram.com
// for initial authorization and short-lived token exchange. Long-lived token exchange,
// refresh, and Graph API calls use graph.facebook.com (confirmed 2026-08-14).
// Scope name 'instagram_business_basic' is current (confirmed 2026-08-14).
// Media fields (id, caption, timestamp, like_count, comments_count, permalink) all
// exist on IG Media objects (confirmed 2026-08-14).
// Note: Instagram historically maintains separate oauth endpoints at api.instagram.com
// for compatibility; Graph API base is https://graph.facebook.com per Meta docs.
const AUTHORIZE_URL = 'https://api.instagram.com/oauth/authorize';
const SHORT_LIVED_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_EXCHANGE_URL = 'https://graph.facebook.com/access_token';
const REFRESH_URL = 'https://graph.facebook.com/refresh_access_token';
const USER_INFO_URL = 'https://graph.facebook.com/me';
const MEDIA_URL = 'https://graph.facebook.com/me/media';

const SCOPES = 'instagram_business_basic';

// Mirrors PROFILE_SCRAPE_RESULTS_LIMIT in lib/integrations/scraper.ts —
// see spec §4.
const PROFILE_POSTS_MAX_RESULTS = 50;

function parseExpiresAt(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

export function createInstagramOAuthClient(clientId: string, clientSecret: string): OAuthProviderClient {
  return {
    buildAuthorizeUrl(state: string, redirectUri: string): string {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet> {
      const shortLivedResponse = await fetch(SHORT_LIVED_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      });
      if (!shortLivedResponse.ok) {
        throw new Error(`Instagram token exchange failed with status ${shortLivedResponse.status}`);
      }
      const shortLivedData = await shortLivedResponse.json();

      // Instagram issues a short-lived (~1 hour) token first; it must be
      // exchanged once for a long-lived (~60 day) token before storing —
      // there is no separate refresh_token grant here. See spec §3.
      const longLivedUrl = new URL(LONG_LIVED_EXCHANGE_URL);
      longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
      longLivedUrl.searchParams.set('client_secret', clientSecret);
      longLivedUrl.searchParams.set('access_token', shortLivedData.access_token);
      const longLivedResponse = await fetch(longLivedUrl.toString());
      if (!longLivedResponse.ok) {
        throw new Error(`Instagram long-lived token exchange failed with status ${longLivedResponse.status}`);
      }
      const longLivedData = await longLivedResponse.json();

      return {
        accessToken: longLivedData.access_token,
        refreshToken: null,
        expiresAt: parseExpiresAt(longLivedData.expires_in),
      };
    },

    async getProviderUserId(accessToken: string): Promise<string> {
      const url = new URL(USER_INFO_URL);
      url.searchParams.set('fields', 'user_id');
      url.searchParams.set('access_token', accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram user info request failed with status ${response.status}`);
      }
      const data = await response.json();
      if (!data.user_id) {
        throw new Error('Instagram user info response did not include user_id');
      }
      return String(data.user_id);
    },

    async refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet> {
      // Instagram's long-lived token refreshes by presenting itself, not a
      // separate refresh token — see spec §3.
      const url = new URL(REFRESH_URL);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', current.accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram token refresh failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async fetchProfilePosts(accessToken: string): Promise<ProfilePost[]> {
      const url = new URL(MEDIA_URL);
      url.searchParams.set('fields', 'id,caption,timestamp,like_count,comments_count,permalink');
      url.searchParams.set('limit', String(PROFILE_POSTS_MAX_RESULTS));
      url.searchParams.set('access_token', accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram media list request failed with status ${response.status}`);
      }
      const data = await response.json();
      const items: Array<Record<string, unknown>> = data.data ?? [];
      return items.map((item) => ({
        platform: 'instagram' as const,
        id: String(item.id),
        caption: String(item.caption ?? ''),
        publishedAt: String(item.timestamp),
        // Instagram Graph API's media-list fields don't expose view/play
        // counts (that needs a separate Insights permission this client
        // doesn't request) — a known, documented gap versus the Apify
        // path, not a bug. See this task's "Known limitation" note.
        viewCount: 0,
        likeCount: Number(item.like_count ?? 0),
        commentCount: Number(item.comments_count ?? 0),
        permalink: String(item.permalink ?? ''),
      }));
    },
  };
}
