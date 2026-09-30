import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateProfile } from '@/lib/settings/profile-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateProfile(
    {
      saveDisplayName: async (profileId, displayName) => {
        const { error } = await serviceClient.from('profiles').update({ display_name: displayName }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save display name: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, displayName: typeof body.displayName === 'string' ? body.displayName : '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
