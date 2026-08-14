import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { disconnectPlatform } from '@/lib/oauth/connections';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import type { OAuthPlatform } from '@/lib/oauth/types';

function isSupportedPlatform(value: string): value is OAuthPlatform {
  return value === 'tiktok' || value === 'instagram';
}

export async function POST(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isSupportedPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported platform.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to disconnect a platform.' }, { status: 401 });
  }

  try {
    const serviceClient = createSupabaseServiceRoleClient();
    await disconnectPlatform(
      {
        getConnectionRow: async (profileId, connectedPlatform) => {
          const { data } = await serviceClient
            .from('platform_connections')
            .select('*')
            .eq('profile_id', profileId)
            .eq('platform', connectedPlatform)
            .maybeSingle();
          if (!data) return null;
          return {
            profileId: data.profile_id,
            platform: data.platform as OAuthPlatform,
            providerUserId: data.provider_user_id,
            accessTokenEncrypted: data.access_token_encrypted,
            refreshTokenEncrypted: data.refresh_token_encrypted,
            expiresAt: data.expires_at ? new Date(data.expires_at) : null,
          };
        },
        providerClients: {
          tiktok: createTikTokOAuthClient(process.env.TIKTOK_CLIENT_ID ?? '', process.env.TIKTOK_CLIENT_SECRET ?? ''),
          instagram: createInstagramOAuthClient(process.env.INSTAGRAM_CLIENT_ID ?? '', process.env.INSTAGRAM_CLIENT_SECRET ?? ''),
        },
        encryptionKey: process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '',
        deleteConnection: async (profileId, connectedPlatform) => {
          const { error } = await serviceClient
            .from('platform_connections')
            .delete()
            .eq('profile_id', profileId)
            .eq('platform', connectedPlatform);
          if (error) {
            throw new Error(`Failed to disconnect ${connectedPlatform}: ${error.message}`);
          }
        },
      },
      user.id,
      platform
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Disconnect failed:', err);
    return NextResponse.json({ error: 'Something went wrong disconnecting that platform. Please try again.' }, { status: 500 });
  }
}
