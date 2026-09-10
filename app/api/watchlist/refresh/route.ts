// app/api/watchlist/refresh/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { deriveClientIp } from '@/lib/ip';
import { handleRefreshWatchlistEntry } from '@/lib/watchlist/handler';
import { createWatchlistDataDeps } from '@/lib/watchlist/supabase-deps';

/**
 * Refreshes exactly one watchlist entry: the paid, rate-limited, externally-
 * fetching half of the feature. POST (not GET) because it spends money and
 * writes rows; one entry per request so the work is time-bounded.
 */
export async function POST(request: Request) {
  try {
    const { entryId } = (await request.json()) as { entryId?: string };
    if (!entryId) {
      return NextResponse.json({ error: 'A watchlist entry id is required.' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();
    const ip = deriveClientIp({
      headers: request.headers,
      isTrustedPlatform: process.env.VERCEL === '1',
      trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
    });

    const result = await handleRefreshWatchlistEntry(
      {
        ...createWatchlistDataDeps(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
      },
      { profileId: user?.id ?? null, ip, entryId, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Refreshing a watchlist entry failed:', err);
    return NextResponse.json({ error: 'Something went wrong refreshing that competitor. Please try again.' }, { status: 500 });
  }
}
