import type { OAuthPlatform, OAuthProviderClient } from './types';

export interface OAuthCallbackDeps {
  providerClient: OAuthProviderClient;
  saveConnection: (params: {
    profileId: string;
    platform: OAuthPlatform;
    providerUserId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }) => Promise<void>;
}

export interface OAuthCallbackContext {
  platform: OAuthPlatform;
  profileId: string | null;
  code: string | null;
  error: string | null;
  state: string | null;
  expectedState: string | null;
  redirectUri: string;
  origin: string;
}

export interface OAuthCallbackResult {
  redirectUrl: string;
}

function buildErrorRedirect(origin: string, errorCode: string): string {
  const url = new URL('/recap', origin);
  url.searchParams.set('oauthError', errorCode);
  return url.toString();
}

export async function handleOAuthCallback(deps: OAuthCallbackDeps, context: OAuthCallbackContext): Promise<OAuthCallbackResult> {
  if (!context.profileId) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'not_signed_in') };
  }

  if (context.error) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'denied') };
  }

  if (!context.state || !context.expectedState || context.state !== context.expectedState) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'invalid_state') };
  }

  if (!context.code) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'exchange_failed') };
  }

  try {
    const tokenSet = await deps.providerClient.exchangeCode(context.code, context.redirectUri);
    const providerUserId = await deps.providerClient.getProviderUserId(tokenSet.accessToken);
    await deps.saveConnection({
      profileId: context.profileId,
      platform: context.platform,
      providerUserId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
    });
  } catch (err) {
    console.error(`OAuth callback failed for ${context.platform}:`, err);
    return { redirectUrl: buildErrorRedirect(context.origin, 'exchange_failed') };
  }

  const successUrl = new URL('/recap', context.origin);
  successUrl.searchParams.set('connected', context.platform);
  return { redirectUrl: successUrl.toString() };
}
