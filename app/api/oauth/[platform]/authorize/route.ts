import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import { generateOAuthState, oauthStateCookieName } from '@/lib/oauth/state';
import type { OAuthPlatform, OAuthProviderClient } from '@/lib/oauth/types';

const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes — long enough for a real consent-screen round trip

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
  if (!isSupportedPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported platform.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to connect a platform.' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const redirectUri = `${requestUrl.origin}/api/oauth/${platform}/callback`;
  const state = generateOAuthState();

  const cookieStore = await cookies();
  cookieStore.set({
    name: oauthStateCookieName(platform),
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });

  const providerClient = createProviderClient(platform);
  return NextResponse.redirect(providerClient.buildAuthorizeUrl(state, redirectUri));
}
