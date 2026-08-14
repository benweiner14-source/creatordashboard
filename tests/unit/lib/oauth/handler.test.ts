import { describe, it, expect, vi } from 'vitest';
import { handleOAuthCallback } from '@/lib/oauth/handler';
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';

function makeContext(overrides: Partial<Parameters<typeof handleOAuthCallback>[1]> = {}) {
  return {
    platform: 'tiktok' as const,
    profileId: 'profile-1',
    code: 'auth-code',
    error: null,
    state: 'nonce-123',
    expectedState: 'nonce-123',
    redirectUri: 'https://app.example.com/api/oauth/tiktok/callback',
    origin: 'https://app.example.com',
    ...overrides,
  };
}

describe('handleOAuthCallback', () => {
  it('redirects to /recap?oauthError=not_signed_in when there is no profile', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ profileId: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=not_signed_in');
  });

  it('redirects to /recap?oauthError=denied when the provider reports an error, without exchanging a code', async () => {
    const saveConnection = vi.fn();
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection },
      makeContext({ error: 'access_denied' })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=denied');
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it('redirects to /recap?oauthError=invalid_state when the state does not match the cookie', async () => {
    const saveConnection = vi.fn();
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection },
      makeContext({ state: 'nonce-123', expectedState: 'different-nonce' })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=invalid_state');
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it('redirects to /recap?oauthError=invalid_state when there is no expected state cookie at all', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ expectedState: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });

  it('exchanges the code, saves the connection, and redirects to /recap?connected=<platform> on success', async () => {
    const providerClient = createFakeOAuthProviderClient({
      exchangeCode: async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null }),
      getProviderUserId: async () => 'provider-user-1',
    });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const result = await handleOAuthCallback({ providerClient, saveConnection }, makeContext());

    expect(saveConnection).toHaveBeenCalledWith({
      profileId: 'profile-1',
      platform: 'tiktok',
      providerUserId: 'provider-user-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: null,
    });
    expect(result.redirectUrl).toBe('https://app.example.com/recap?connected=tiktok');
  });

  it('redirects to /recap?oauthError=exchange_failed when the code exchange throws', async () => {
    const providerClient = createFakeOAuthProviderClient({
      exchangeCode: async () => {
        throw new Error('network error');
      },
    });
    const result = await handleOAuthCallback({ providerClient, saveConnection: vi.fn() }, makeContext());
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=exchange_failed');
  });

  it('redirects to /recap?oauthError=exchange_failed when there is no code and no provider error', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ code: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=exchange_failed');
  });
});
