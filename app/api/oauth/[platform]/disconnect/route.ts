import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { disconnectPlatform } from '@/lib/oauth/connections';
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

  const serviceClient = createSupabaseServiceRoleClient();
  await disconnectPlatform(
    {
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
}
