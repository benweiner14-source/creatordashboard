import { describe, it, expect } from 'vitest';
import { generateOAuthState, oauthStateCookieName } from '@/lib/oauth/state';

describe('generateOAuthState', () => {
  it('generates a non-empty hex string', () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[a-f0-9]+$/);
    expect(state.length).toBeGreaterThan(16);
  });

  it('generates a different value on each call', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe('oauthStateCookieName', () => {
  it('namespaces the cookie name by platform', () => {
    expect(oauthStateCookieName('tiktok')).toBe('oauth_state_tiktok');
    expect(oauthStateCookieName('instagram')).toBe('oauth_state_instagram');
  });
});
