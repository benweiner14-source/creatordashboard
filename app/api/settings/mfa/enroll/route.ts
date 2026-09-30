import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleEnrollMfa } from '@/lib/settings/mfa-handler';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await handleEnrollMfa(
    {
      enroll: async () => {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        return { data: data as { id: string; totp: { qr_code: string; secret: string } } | null, error };
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
