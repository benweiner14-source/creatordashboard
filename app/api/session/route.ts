import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A user without an email can't be rendered as an identity by <AppNav>, and
  // returning 200 with an empty string just pushes the "is this signed in?"
  // decision onto the client. Treat it as not properly signed in here instead.
  if (!user || !user.email) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  // Signing back in cancels any pending account deletion: hitting this route
  // is how <AppNav> confirms a session on every authenticated page load, so
  // it doubles as the "the user is back" signal for Task 15's scheduled
  // deletion.
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('scheduled_deletion_at')
    .eq('id', user.id)
    .single();

  if (profile?.scheduled_deletion_at) {
    await serviceClient.from('profiles').update({ scheduled_deletion_at: null }).eq('id', user.id);
    return NextResponse.json({ email: user.email, justCancelledDeletion: true });
  }

  return NextResponse.json({ email: user.email });
}
