import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import { encryptToken } from '@/lib/crypto';
import { oauthStateCookieName } from '@/lib/oauth/state';
import { handleOAuthCallback } from '@/lib/oauth/handler';
import type { OAuthPlatform, OAuthProviderClient } from '@/lib/oauth/types';

function isSupportedPlatform(value: string): value is OAuthPlatform {
  return value === 'tiktok' || value === 'instagram';
}

function createProviderClient(platform: OAuthPlatform): OAuthProviderClient {
  if (platform === 'tiktok') {
    return createTikTokOAuthClient(process.env.TIKTOK_CLIENT_ID ?? '', process.env.TIKTOK_CLIENT_SECRET ?? '');
  }
  return createInstagramOAuthClient(process.env.INSTAGRAM_CLIENT_ID ?? '', process.env.INSTAGRAM_CLIENT_SECRET ?? '');
}

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const requestUrl = new URL(request.url);

  if (!isSupportedPlatform(platform)) {
    return NextResponse.redirect(new URL('/recap?oauthError=invalid_state', requestUrl.origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cookieStore = await cookies();
  const cookieName = oauthStateCookieName(platform);
  const expectedState = cookieStore.get(cookieName)?.value ?? null;
  cookieStore.delete(cookieName);

  const serviceClient = createSupabaseServiceRoleClient();
  const encryptionKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';

  const result = await handleOAuthCallback(
    {
      providerClient: createProviderClient(platform),
      saveConnection: async ({ profileId, platform: connectedPlatform, providerUserId, accessToken, refreshToken, expiresAt }) => {
        const { error } = await serviceClient.from('platform_connections').upsert(
          {
            profile_id: profileId,
            platform: connectedPlatform,
            provider_user_id: providerUserId,
            access_token_encrypted: encryptToken(accessToken, encryptionKey),
            refresh_token_encrypted: refreshToken ? encryptToken(refreshToken, encryptionKey) : null,
            expires_at: expiresAt ? expiresAt.toISOString() : null,
          },
          { onConflict: 'profile_id,platform' }
        );
        if (error) {
          throw new Error(`Failed to save platform connection: ${error.message}`);
        }
      },
    },
    {
      platform,
      profileId: user?.id ?? null,
      code: requestUrl.searchParams.get('code'),
      error: requestUrl.searchParams.get('error'),
      state: requestUrl.searchParams.get('state'),
      expectedState,
      redirectUri: `${requestUrl.origin}/api/oauth/${platform}/callback`,
      origin: requestUrl.origin,
    }
  );

  return NextResponse.redirect(result.redirectUrl);
}
