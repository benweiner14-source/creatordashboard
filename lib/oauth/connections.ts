import { decryptToken } from '@/lib/crypto';
import type { OAuthPlatform, OAuthProviderClient } from './types';

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

export interface ActiveConnection {
  accessToken: string;
}

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
 * if it's expired or about to expire. Returns null if there's no
 * connection, or if refresh was needed and failed — in the failure case
 * the broken row is deleted so /recap reflects "disconnected" on next
 * load. See docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §3.
 */
export async function getPlatformConnection(
  deps: GetPlatformConnectionDeps,
  profileId: string,
  platform: OAuthPlatform,
  now: Date = new Date()
): Promise<ActiveConnection | null> {
  const row = await deps.getConnectionRow(profileId, platform);
  if (!row) return null;

  const accessToken = decryptToken(row.accessTokenEncrypted, deps.encryptionKey);

  if (!needsRefresh(row.expiresAt, now)) {
    return { accessToken };
  }

  const refreshToken = row.refreshTokenEncrypted ? decryptToken(row.refreshTokenEncrypted, deps.encryptionKey) : null;

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
    return { accessToken: refreshed.accessToken };
  } catch (err) {
    console.error(`Failed to refresh ${platform} token for profile ${profileId}, clearing connection:`, err);
    await deps.deleteConnection(profileId, platform);
    return null;
  }
}

export interface DisconnectPlatformDeps {
  deleteConnection: (profileId: string, platform: OAuthPlatform) => Promise<void>;
}

export async function disconnectPlatform(deps: DisconnectPlatformDeps, profileId: string, platform: OAuthPlatform): Promise<void> {
  await deps.deleteConnection(profileId, platform);
}
