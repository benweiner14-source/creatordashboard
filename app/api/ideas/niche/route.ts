import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveNiche } from '@/lib/ideas/niche';

export async function POST(request: Request) {
  const body = (await request.json()) as { niche?: string };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to set your niche.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveNiche(
    {
      updateProfileNiche: async (profileId, niche) => {
        const { error } = await serviceClient.from('profiles').update({ niche }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save niche: ${error.message}`);
        }
      },
    },
    { profileId: user.id, niche: body.niche ?? '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
