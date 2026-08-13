import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requestMagicLink } from '@/lib/auth/magic-link';

export async function POST(request: Request) {
  const { email, redirectPath } = (await request.json()) as { email?: string; redirectPath?: string };
  if (!email) {
    return NextResponse.json({ error: 'An email address is required.' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServerClient();
    const origin = new URL(request.url).origin;

    const result = await requestMagicLink(
      { signInWithOtp: (params) => supabase.auth.signInWithOtp(params) },
      { email, redirectPath: redirectPath ?? '/diagnostic', origin }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Magic link request failed:', err);
    return NextResponse.json(
      { error: "We couldn't reach the server. Check your connection and try again." },
      { status: 500 }
    );
  }
}
