import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('strategy_breakdowns').select('*').eq('id', id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Strategy breakdown not found.' }, { status: 404 });
  }

  return NextResponse.json({ breakdown: data });
}
