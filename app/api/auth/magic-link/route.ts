import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { deriveClientIp } from '@/lib/ip';
import { requestMagicLink } from '@/lib/auth/magic-link';

export async function POST(request: Request) {
  const { email, redirectPath } = (await request.json()) as { email?: string; redirectPath?: string };
  if (!email) {
    return NextResponse.json({ error: 'An email address is required.' }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const serviceClient = createSupabaseServiceRoleClient();
    const origin = new URL(request.url).origin;
    const ip = deriveClientIp({
      headers: request.headers,
      isTrustedPlatform: process.env.VERCEL === '1',
      trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
    });

    const result = await requestMagicLink(
      {
        signInWithOtp: (params) =>
          supabase.auth.signInWithOtp({ email: params.email, options: { emailRedirectTo: params.emailRedirectTo } }),
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
      },
      { email, redirectPath: redirectPath ?? '/diagnostic', origin, ip }
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
