import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateYoutubeHandle } from '@/lib/settings/platforms-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateYoutubeHandle(
    {
      saveYoutubeHandle: async (profileId, handle) => {
        const { error } = await serviceClient.from('profiles').update({ youtube_channel_handle: handle }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save YouTube handle: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, handle: typeof body.handle === 'string' || body.handle === null ? body.handle : null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
