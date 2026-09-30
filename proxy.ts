import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSafeRelativePath } from '@/lib/auth/callback';

// Pages that must stay reachable even when a session hasn't cleared its AAL2
// (TOTP) challenge yet: the challenge page itself (redirecting to it would
// loop forever) and the magic-link callback route, which issues that very
// redirect from a still-AAL1 session.
const MFA_EXEMPT_PAGES = new Set(['/auth/mfa-challenge', '/auth/callback']);

// API routes the challenge page itself depends on to function, plus sign-out
// so a locked-out user isn't stuck unable to leave the account.
const MFA_EXEMPT_API_ROUTES = new Set([
  '/api/settings/mfa/factors',
  '/api/settings/mfa/verify',
  '/api/auth/sign-out',
]);

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

  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith('/api/');
  const isExempt = isApiRoute ? MFA_EXEMPT_API_ROUTES.has(pathname) : MFA_EXEMPT_PAGES.has(pathname);

  if (!isExempt) {
    // A verified-magic-link session is already fully valid (AAL1) by this
    // point — see lib/auth/callback.ts. For an account with a verified TOTP
    // factor, `nextLevel` reports the level the session is ELIGIBLE for
    // (aal2) even though `currentLevel` hasn't cleared that challenge yet.
    // That gap is exactly the window an attacker who only controls the
    // magic-link inbox (not the authenticator app) would otherwise walk
    // through by typing any URL instead of the TOTP code.
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      // Same fail-open ruling as Task 9's listFactors() failure handling
      // (see .superpowers/sdd/2026-09-30-settings-backend/progress.md):
      // failing closed here would lock out the entire non-2FA user base on
      // a rare transient Supabase error. Log it so the failure is visible.
      console.error('MFA assurance level check failed; failing open:', error);
    } else if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
      if (isApiRoute) {
        return NextResponse.json({ error: 'MFA verification required.' }, { status: 401 });
      }
      const challengeUrl = new URL('/auth/mfa-challenge', request.url);
      const nextPath = `${pathname}${request.nextUrl.search}`;
      challengeUrl.searchParams.set('next', isSafeRelativePath(nextPath) ? nextPath : '/home');
      return NextResponse.redirect(challengeUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
