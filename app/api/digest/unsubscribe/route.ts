import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { verifyUnsubscribeToken } from '@/lib/digest/unsubscribe-token';
import { handleUnsubscribe } from '@/lib/digest/unsubscribe';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceClient = createSupabaseServiceRoleClient();
  const secret = process.env.DIGEST_UNSUBSCRIBE_SECRET ?? '';

  const result = await handleUnsubscribe(
    {
      verifyToken: (profileId, token) => verifyUnsubscribeToken(profileId, token, secret),
      setOptOut: async (profileId) => {
        await serviceClient.from('profiles').update({ digest_email_opt_in: false }).eq('id', profileId);
      },
    },
    { profileId: url.searchParams.get('profile'), token: url.searchParams.get('token') }
  );

  return NextResponse.redirect(new URL(`/digest/unsubscribed?status=${result.status}`, url.origin));
}
