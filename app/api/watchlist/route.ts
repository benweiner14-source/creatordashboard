// app/api/watchlist/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleAddWatchlistEntry, handleListWatchlist } from '@/lib/watchlist/handler';
import { createWatchlistDataDeps } from '@/lib/watchlist/supabase-deps';

/**
 * Read-only. Lists tracked competitors with their last-known snapshot, deltas,
 * and an `isStale` flag; it makes no external API call, spends no rate-limit
 * budget, and writes nothing. Refreshing a stale entry costs money and lives
 * behind POST /api/watchlist/refresh — same reasoning as the GET handler in
 * `app/api/linkedin/ideas/route.ts`: Supabase's SameSite=Lax auth cookies ride
 * along on a cross-site top-level GET navigation, so paid/mutating work must
 * never be reachable by `window.location = '.../api/watchlist'`.
 *
 * Sign-in gated only — an unsubscribed creator can still read data they already
 * paid to generate; the response's `subscriptionRequired` tells the client that
 * refreshing isn't available.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleListWatchlist(createWatchlistDataDeps(serviceClient), {
    profileId: user?.id ?? null,
    now: new Date(),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  try {
    const { url, label } = (await request.json()) as { url?: string; label?: string };
    if (!url) {
      return NextResponse.json({ error: 'A channel or profile URL is required.' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();

    const result = await handleAddWatchlistEntry(createWatchlistDataDeps(serviceClient), {
      profileId: user?.id ?? null,
      url,
      label,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Adding a watchlist entry failed:', err);
    return NextResponse.json({ error: 'Something went wrong adding that competitor. Please try again.' }, { status: 500 });
  }
}
