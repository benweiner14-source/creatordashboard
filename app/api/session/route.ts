import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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

  return NextResponse.json({ email: user.email });
}
