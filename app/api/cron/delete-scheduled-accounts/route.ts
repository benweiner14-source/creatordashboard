import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const maxDuration = 300;

function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: dueProfiles, error } = await serviceClient
    .from('profiles')
    .select('id')
    .not('scheduled_deletion_at', 'is', null)
    .lt('scheduled_deletion_at', new Date().toISOString());

  if (error) {
    console.error('Failed to fetch profiles due for deletion:', error.message);
    return NextResponse.json({ error: 'Failed to fetch profiles due for deletion' }, { status: 500 });
  }

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const profile of dueProfiles ?? []) {
    // The on-delete-cascade chain from auth.users -> profiles -> every
    // feature table's own profile_id FK deletes everything else for free —
    // no per-table cleanup needed here. See design spec §7.
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(profile.id);
    if (deleteError) {
      console.error(`Failed to delete profile ${profile.id}:`, deleteError.message);
      failed.push(profile.id);
      continue;
    }
    deleted.push(profile.id);
  }

  return NextResponse.json({ deleted: deleted.length, failed: failed.length });
}
