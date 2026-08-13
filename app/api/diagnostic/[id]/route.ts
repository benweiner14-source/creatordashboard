import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('diagnostics').select('*').eq('id', id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Diagnostic not found.' }, { status: 404 });
  }

  return NextResponse.json({ diagnostic: data });
}
