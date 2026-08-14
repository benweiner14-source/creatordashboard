import type { ProfilePost } from '@/lib/integrations/scraper';

export type OAuthPlatform = 'tiktok' | 'instagram';

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

/**
 * Shared shape both lib/integrations/tiktok-oauth.ts and
 * lib/integrations/instagram-oauth.ts implement, so lib/oauth/handler.ts,
 * lib/oauth/connections.ts, and lib/recap/handler.ts can all depend on one
 * interface regardless of platform. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §2 (Approach A).
 */
export interface OAuthProviderClient {
  buildAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet>;
  getProviderUserId(accessToken: string): Promise<string>;
  /**
   * TikTok presents a distinct refresh_token; Instagram's long-lived token
   * refreshes by presenting itself. Each client's refreshAccessToken
   * accepts the current token set and knows which value to use internally
   * — callers never need to know the difference. See spec §3.
   */
  refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet>;
  fetchProfilePosts(accessToken: string): Promise<ProfilePost[]>;
}
