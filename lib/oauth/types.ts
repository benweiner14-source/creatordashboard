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
  /**
   * Best-effort call to the provider's own token-revocation endpoint, for
   * platforms that document one. Optional because not every platform
   * exposes a client-callable revoke — see lib/integrations/instagram-oauth.ts
   * for the verified absence on Instagram's "Business Login for
   * Instagram" product. Callers must treat a rejected promise as
   * non-fatal and never let it block the local connection delete.
   */
  revokeToken?(accessToken: string): Promise<void>;
}

/**
 * Thrown by refreshAccessToken when the provider indicates the refresh
 * token itself is invalid, expired, or revoked (a definitive, permanent
 * failure) — as opposed to a network blip or a transient 5xx, which
 * should NOT cause the stored connection to be deleted. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §3.
 */
export class OAuthRefreshInvalidError extends Error {}
