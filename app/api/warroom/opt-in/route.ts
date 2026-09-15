import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { handleWarroomOptIn } from '@/lib/warroom/handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleWarroomOptIn(
    {
      // Real, not a stub: handleWarroomOptIn calls this when optIn is true
      // (Task 9) to block a non-subscriber from turning on email alerts for
      // a feature they can't otherwise view. Stubbing this to always return
      // true would silently defeat that check.
      hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
      getRecentAlerts: async () => [], // unused on this route
      setEmailOptIn: async (profileId, optIn) => {
        const { error } = await serviceClient.from('profiles').update({ warroom_email_opt_in: optIn }).eq('id', profileId);
        if (error) {
          // Mirrors app/api/digest/opt-in/route.ts's updateDigestOptIn: a
          // silently-failed write must not report { ok: true } back to the
          // client, or the user believes their preference was saved when
          // it wasn't.
          throw new Error(`Failed to save War Room email preference: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, optIn: Boolean(body.optIn) }
  );

  return NextResponse.json(result.body, { status: result.status });
}
