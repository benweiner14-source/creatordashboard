import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const [{ data }, { data: profile }] = await Promise.all([
    serviceClient.from('subscriptions').select('status,current_period_end,cancel_at_period_end').eq('profile_id', user.id).maybeSingle(),
    serviceClient.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);
  const timezone = profile?.timezone ?? 'UTC';

  if (!data || (data.status !== 'active' && data.status !== 'past_due')) {
    return NextResponse.json({ status: 'free' });
  }

  return NextResponse.json({
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    timezone,
  });
}
