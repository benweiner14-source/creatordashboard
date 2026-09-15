import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleRemoveWatchlistEntry } from '@/lib/watchlist/handler';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleRemoveWatchlistEntry(
    {
      deleteEntry: async (profileId: string, entryId: string) => {
        const { error, count } = await serviceClient
          .from('watchlist_entries')
          .delete({ count: 'exact' })
          .eq('id', entryId)
          .eq('profile_id', profileId);
        if (error) throw new Error(`Failed to remove watchlist entry: ${error.message}`);
        return (count ?? 0) > 0;
      },
    },
    { profileId: user?.id ?? null, entryId: id }
  );

  return NextResponse.json(result.body, { status: result.status });
}
