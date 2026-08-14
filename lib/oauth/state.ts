import { randomBytes } from 'node:crypto';

const OAUTH_STATE_COOKIE_PREFIX = 'oauth_state_';

export function oauthStateCookieName(platform: string): string {
  return `${OAUTH_STATE_COOKIE_PREFIX}${platform}`;
}

/**
 * A random nonce used as the OAuth `state` param — proves a callback is a
 * continuation of an authorize request this app actually issued (CSRF
 * protection), checked against a short-lived cookie set at authorize time.
 * See docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §2.
 */
export function generateOAuthState(): string {
  return randomBytes(16).toString('hex');
}
