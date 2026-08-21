import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveDigestOptIn } from '@/lib/digest/opt-in';
import { hasActiveSubscription } from '@/lib/billing/entitlements';

export async function POST(request: Request) {
  const body = (await request.json()) as { optIn?: boolean };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to change this setting.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveDigestOptIn(
    {
      getProfileNiche: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('niche').eq('id', profileId).single();
        return data?.niche ?? null;
      },
      updateDigestOptIn: async (profileId, optIn) => {
        const { error } = await serviceClient.from('profiles').update({ digest_email_opt_in: optIn }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save digest opt-in: ${error.message}`);
        }
      },
      hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
    },
    { profileId: user.id, optIn: body.optIn === true }
  );

  return NextResponse.json(result.body, { status: result.status });
}
