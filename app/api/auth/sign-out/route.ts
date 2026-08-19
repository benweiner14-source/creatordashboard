import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  // A failed signOut leaves the session cookie valid. Reporting `{ ok: true }`
  // anyway would send the client to '/', which redirects signed-in visitors
  // right back to /home — looking like the sign-out worked when it didn't.
  if (error) {
    return NextResponse.json({ error: "We couldn't sign you out. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
