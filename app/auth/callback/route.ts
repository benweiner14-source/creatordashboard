import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleAuthCallback } from '@/lib/auth/callback';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/diagnostic';

  const supabase = createSupabaseServerClient();
  const result = await handleAuthCallback(
    { exchangeCodeForSession: (c) => supabase.auth.exchangeCodeForSession(c) },
    { code, next, origin: requestUrl.origin }
  );

  return NextResponse.redirect(result.redirectUrl);
}
