import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { RecapCardRow } from '@/lib/recap/types';

function mapRecapCardRow(row: {
  id: string;
  profile_id: string;
  month: string;
  platform_data: unknown;
  totals: unknown;
  top_post: unknown;
  warnings: string[];
  generated_at: string;
}): RecapCardRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    month: row.month,
    platformData: row.platform_data as RecapCardRow['platformData'],
    totals: row.totals as RecapCardRow['totals'],
    topPost: row.top_post as RecapCardRow['topPost'],
    warnings: row.warnings,
    generatedAt: row.generated_at,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Public by design: recap_cards' RLS policy restricts reads to the
  // owner, but this route is the shareable card's data source — a link a
  // creator hands to their own audience, so it deliberately bypasses that
  // policy via the service-role client, the same reasoning as
  // app/recap/[id]/image/route.tsx below. The stats stored here aren't
  // sensitive; that's what makes this an acceptable public surface.
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from('recap_cards').select('*').eq('id', id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Recap card not found.' }, { status: 404 });
  }

  return NextResponse.json({ recapCard: mapRecapCardRow(data) });
}
