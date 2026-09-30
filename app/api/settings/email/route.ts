import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleChangeEmail } from '@/lib/settings/email-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = await request.json().catch(() => ({}));

  const result = await handleChangeEmail(
    {
      updateEmail: (email) => supabase.auth.updateUser({ email }),
    },
    { profileId: user?.id ?? null, email: typeof body.email === 'string' ? body.email : '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
