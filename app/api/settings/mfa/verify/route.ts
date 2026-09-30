import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { handleVerifyMfa } from '@/lib/settings/mfa-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = await request.json().catch(() => ({}));

  const result = await handleVerifyMfa(
    {
      rateLimitStore: createSupabaseRateLimitStore(createSupabaseServiceRoleClient()),
      challengeAndVerify: async (factorId, code) => {
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
        return { error };
      },
    },
    {
      profileId: user?.id ?? null,
      factorId: typeof body.factorId === 'string' ? body.factorId : '',
      code: typeof body.code === 'string' ? body.code : '',
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
