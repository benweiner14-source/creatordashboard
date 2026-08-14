import { describe, it, expect, vi } from 'vitest';
import { getPlatformConnection, disconnectPlatform } from '@/lib/oauth/connections';
import { encryptToken } from '@/lib/crypto';
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';

const TEST_KEY = '0'.repeat(64);
const NOW = new Date('2026-08-14T12:00:00Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    profileId: 'profile-1',
    platform: 'tiktok' as const,
    providerUserId: 'provider-user-1',
    accessTokenEncrypted: encryptToken('valid-access-token', TEST_KEY),
    refreshTokenEncrypted: encryptToken('valid-refresh-token', TEST_KEY),
    expiresAt: new Date('2026-08-15T12:00:00Z'), // well in the future relative to NOW
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    providerClients: { tiktok: createFakeOAuthProviderClient(), instagram: createFakeOAuthProviderClient() },
    encryptionKey: TEST_KEY,
    getConnectionRow: async () => null,
    updateConnectionTokens: vi.fn(),
    deleteConnection: vi.fn(),
    ...overrides,
  };
}

describe('getPlatformConnection', () => {
  it('returns null when there is no connection row', async () => {
    const result = await getPlatformConnection(makeDeps(), 'profile-1', 'tiktok', NOW);
    expect(result).toBeNull();
  });

  it('returns the decrypted access token without refreshing when the token is not near expiry', async () => {
    const refreshAccessToken = vi.fn();
    const deps = makeDeps({
      providerClients: { tiktok: createFakeOAuthProviderClient({ refreshAccessToken }), instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => makeRow(),
    });
    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ accessToken: 'valid-access-token' });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes and returns the new access token when the token is within the expiry buffer', async () => {
    const updateConnectionTokens = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => ({ accessToken: 'refreshed-access-token', refreshToken: 'refreshed-refresh-token', expiresAt: null }),
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:03:00Z') }); // 3 minutes out, within the 5-minute buffer
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      updateConnectionTokens,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ accessToken: 'refreshed-access-token' });
    expect(updateConnectionTokens).toHaveBeenCalledWith({
      profileId: 'profile-1',
      platform: 'tiktok',
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresAt: null,
    });
  });

  it('deletes the connection and returns null when refresh fails', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => {
        throw new Error('refresh token expired');
      },
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:00:00Z') }); // already expired
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      deleteConnection,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toBeNull();
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });
});

describe('disconnectPlatform', () => {
  it('deletes the connection row', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    await disconnectPlatform({ deleteConnection }, 'profile-1', 'tiktok');
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });
});
