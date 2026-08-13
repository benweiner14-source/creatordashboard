import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // This proxy runs on every request (per the matcher below), including
  // pages that never touch Supabase. Before a real project is connected,
  // these env vars are unset — without this guard, createServerClient
  // throws immediately and every page 500s, which is a strictly worse
  // experience than proxy.ts not existing at all. Route handlers that
  // genuinely need Supabase still fail correctly on their own when
  // unconfigured; this only restores browsability for everything else.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Refreshing the session here (rather than only in server components) is
  // what lets the magic-link callback's session cookie be readable by the
  // very next request — the redirect back to /diagnostic.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
