import { decryptToken } from '@/lib/crypto';
import type { OAuthPlatform, OAuthProviderClient } from './types';
import { OAuthRefreshInvalidError } from './types';

export interface PlatformConnectionRow {
  profileId: string;
  platform: OAuthPlatform;
  providerUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
}

export interface GetPlatformConnectionDeps {
  providerClients: Record<OAuthPlatform, OAuthProviderClient>;
  encryptionKey: string;
  getConnectionRow: (profileId: string, platform: OAuthPlatform) => Promise<PlatformConnectionRow | null>;
  updateConnectionTokens: (params: {
    profileId: string;
    platform: OAuthPlatform;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }) => Promise<void>;
  deleteConnection: (profileId: string, platform: OAuthPlatform) => Promise<void>;
}

export type PlatformConnectionResult =
  | { status: 'connected'; accessToken: string }
  | { status: 'not_connected' }
  | { status: 'connection_expired' };

// Refresh proactively once a token is within this window of expiring, not
// only after it has already expired — avoids a request that starts
// mid-generation with a token that expires before the platform responds.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function needsRefresh(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS;
}

/**
 * Reads a creator's connection for a platform, refreshing the token first
 * if it's expired or about to expire. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §3.
 */
export async function getPlatformConnection(
  deps: GetPlatformConnectionDeps,
  profileId: string,
  platform: OAuthPlatform,
  now: Date = new Date()
): Promise<PlatformConnectionResult> {
  const row = await deps.getConnectionRow(profileId, platform);
  if (!row) return { status: 'not_connected' };

  let accessToken: string;
  let refreshToken: string | null;
  try {
    accessToken = decryptToken(row.accessTokenEncrypted, deps.encryptionKey);
    refreshToken = row.refreshTokenEncrypted ? decryptToken(row.refreshTokenEncrypted, deps.encryptionKey) : null;
  } catch (err) {
    // A decryption failure is an operational problem (wrong/rotated
    // encryption key, corrupted ciphertext), not evidence the creator's
    // connection is actually broken — do NOT delete the row, since that
    // would force every creator to re-consent once the real problem is
    // fixed. Just treat this platform as unavailable for this request.
    console.error(`Failed to decrypt ${platform} tokens for profile ${profileId}:`, err);
    return { status: 'not_connected' };
  }

  if (!needsRefresh(row.expiresAt, now)) {
    return { status: 'connected', accessToken };
  }

  try {
    const providerClient = deps.providerClients[platform];
    const refreshed = await providerClient.refreshAccessToken({ accessToken, refreshToken, expiresAt: row.expiresAt });
    await deps.updateConnectionTokens({
      profileId,
      platform,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    return { status: 'connected', accessToken: refreshed.accessToken };
  } catch (err) {
    if (err instanceof OAuthRefreshInvalidError) {
      // The provider has definitively told us this refresh token is dead
      // — this is the only case where deleting the connection is correct.
      console.error(`${platform} refresh token invalid for profile ${profileId}, clearing connection:`, err);
      await deps.deleteConnection(profileId, platform);
      return { status: 'connection_expired' };
    }
    // Network blip, timeout, or a transient 5xx from the provider — the
    // connection is very likely still fine. Leave the row intact so a
    // later attempt can retry the refresh instead of forcing the creator
    // through OAuth consent again.
    console.error(`Transient error refreshing ${platform} token for profile ${profileId}, leaving connection intact:`, err);
    return { status: 'not_connected' };
  }
}

export interface DisconnectPlatformDeps {
  deleteConnection: (profileId: string, platform: OAuthPlatform) => Promise<void>;
  getConnectionRow: (profileId: string, platform: OAuthPlatform) => Promise<PlatformConnectionRow | null>;
  providerClients: Record<OAuthPlatform, OAuthProviderClient>;
  encryptionKey: string;
}

export async function disconnectPlatform(deps: DisconnectPlatformDeps, profileId: string, platform: OAuthPlatform): Promise<void> {
  const row = await deps.getConnectionRow(profileId, platform);
  const revoke = deps.providerClients[platform].revokeToken;
  if (row && revoke) {
    try {
      const accessToken = decryptToken(row.accessTokenEncrypted, deps.encryptionKey);
      await revoke(accessToken);
    } catch (err) {
      // Best-effort only — never block the local disconnect on a failed
      // provider-side revoke (network error, already-expired token, etc.).
      console.error(`Best-effort ${platform} token revoke failed for profile ${profileId}:`, err);
    }
  }
  await deps.deleteConnection(profileId, platform);
}
