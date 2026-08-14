import { describe, it, expect, vi } from 'vitest';
import { getPlatformConnection, disconnectPlatform } from '@/lib/oauth/connections';
import { encryptToken } from '@/lib/crypto';
import { OAuthRefreshInvalidError } from '@/lib/oauth/types';
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
  it('returns not_connected when there is no connection row', async () => {
    const result = await getPlatformConnection(makeDeps(), 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ status: 'not_connected' });
  });

  it('returns the decrypted access token without refreshing when the token is not near expiry', async () => {
    const refreshAccessToken = vi.fn();
    const deps = makeDeps({
      providerClients: { tiktok: createFakeOAuthProviderClient({ refreshAccessToken }), instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => makeRow(),
    });
    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ status: 'connected', accessToken: 'valid-access-token' });
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
    expect(result).toEqual({ status: 'connected', accessToken: 'refreshed-access-token' });
    expect(updateConnectionTokens).toHaveBeenCalledWith({
      profileId: 'profile-1',
      platform: 'tiktok',
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresAt: null,
    });
  });

  it('deletes the connection and returns connection_expired when refresh definitively fails', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => {
        throw new OAuthRefreshInvalidError('refresh token expired');
      },
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:00:00Z') }); // already expired
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      deleteConnection,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ status: 'connection_expired' });
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });

  it('leaves the connection intact and returns not_connected on a transient refresh error', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:00:00Z') }); // already expired
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      deleteConnection,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ status: 'not_connected' });
    expect(deleteConnection).not.toHaveBeenCalled();
  });

  it('returns not_connected without deleting the row when the stored ciphertext fails to decrypt', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const row = makeRow({ accessTokenEncrypted: 'not-valid-ciphertext' });
    const deps = makeDeps({
      getConnectionRow: async () => row,
      deleteConnection,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ status: 'not_connected' });
    expect(deleteConnection).not.toHaveBeenCalled();
  });
});

describe('disconnectPlatform', () => {
  function makeDisconnectDeps(overrides: Record<string, unknown> = {}) {
    return {
      deleteConnection: vi.fn().mockResolvedValue(undefined),
      getConnectionRow: async () => null,
      providerClients: { tiktok: createFakeOAuthProviderClient(), instagram: createFakeOAuthProviderClient() },
      encryptionKey: TEST_KEY,
      ...overrides,
    };
  }

  it('deletes the connection row', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const deps = makeDisconnectDeps({ deleteConnection });
    await disconnectPlatform(deps, 'profile-1', 'tiktok');
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });

  it('calls revokeToken with the decrypted access token before deleting, when the provider supports it', async () => {
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const row = makeRow();
    const deps = makeDisconnectDeps({
      getConnectionRow: async () => row,
      deleteConnection,
      providerClients: { tiktok: createFakeOAuthProviderClient({ revokeToken }), instagram: createFakeOAuthProviderClient() },
    });

    await disconnectPlatform(deps, 'profile-1', 'tiktok');

    expect(revokeToken).toHaveBeenCalledWith('valid-access-token');
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });

  it('still deletes the connection when revokeToken throws (best-effort)', async () => {
    const revokeToken = vi.fn().mockRejectedValue(new Error('provider unreachable'));
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const row = makeRow();
    const deps = makeDisconnectDeps({
      getConnectionRow: async () => row,
      deleteConnection,
      providerClients: { tiktok: createFakeOAuthProviderClient({ revokeToken }), instagram: createFakeOAuthProviderClient() },
    });

    await expect(disconnectPlatform(deps, 'profile-1', 'tiktok')).resolves.toBeUndefined();
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });

  it('deletes the connection without error when the provider has no revokeToken (e.g. Instagram)', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const row = makeRow({ platform: 'instagram' });
    const deps = makeDisconnectDeps({
      getConnectionRow: async () => row,
      deleteConnection,
      providerClients: { tiktok: createFakeOAuthProviderClient(), instagram: createFakeOAuthProviderClient() },
    });

    await expect(disconnectPlatform(deps, 'profile-1', 'instagram')).resolves.toBeUndefined();
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'instagram');
  });
});
