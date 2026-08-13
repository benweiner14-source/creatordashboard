import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveRecapHandles } from '@/lib/recap/handles';

export async function POST(request: Request) {
  const body = (await request.json()) as { youtube?: string; tiktok?: string; instagram?: string };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to connect your platforms.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveRecapHandles(
    {
      updateProfileHandles: async (profileId, handles) => {
        const { error } = await serviceClient
          .from('profiles')
          .update({
            ...(handles.youtube !== undefined ? { youtube_channel_handle: handles.youtube } : {}),
            ...(handles.tiktok !== undefined ? { tiktok_handle: handles.tiktok } : {}),
            ...(handles.instagram !== undefined ? { instagram_handle: handles.instagram } : {}),
          })
          .eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save platform handles: ${error.message}`);
        }
      },
    },
    { profileId: user.id, ...body }
  );

  return NextResponse.json(result.body, { status: result.status });
}
