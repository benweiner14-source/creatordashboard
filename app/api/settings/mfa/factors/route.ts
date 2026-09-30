import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    console.error('MFA factor lookup failed; treating as no factors:', error);
  }
  const verified = (data?.totp ?? []).find((factor) => factor.status === 'verified');
  return NextResponse.json({ factorId: verified?.id ?? null });
}
