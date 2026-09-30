import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleGetPlatforms } from '@/lib/settings/platforms-handler';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleGetPlatforms(
    {
      // Exact same lightweight existence check /api/recap already runs before
      // its own subscription gate — no decryption, no token refresh, no side
      // effects. See design spec §3.
      getConnectedPlatforms: async (profileId) => {
        const { data } = await serviceClient.from('platform_connections').select('platform').eq('profile_id', profileId);
        return (data ?? []).map((row) => row.platform as 'tiktok' | 'instagram');
      },
      getYoutubeHandle: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('youtube_channel_handle').eq('id', profileId).single();
        return data?.youtube_channel_handle ?? null;
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
