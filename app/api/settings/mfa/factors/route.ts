import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((factor) => factor.status === 'verified');
  return NextResponse.json({ factorId: verified?.id ?? null });
}
