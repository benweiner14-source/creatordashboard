// app/api/watchlist/route.ts
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { deriveClientIp } from '@/lib/ip';
import { handleAddWatchlistEntry, handleListWatchlist } from '@/lib/watchlist/handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { DuplicateWatchlistEntryError, type WatchlistEntry, type WatchlistSnapshot } from '@/lib/watchlist/types';
import type { Database } from '@/lib/supabase/types';

const UNIQUE_VIOLATION = '23505';

function mapEntryRow(row: Database['public']['Tables']['watchlist_entries']['Row']): WatchlistEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    platform: row.platform,
    handle: row.handle,
    url: row.url,
    label: row.label,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function mapSnapshotRow(row: Database['public']['Tables']['watchlist_snapshots']['Row']): WatchlistSnapshot {
  return {
    entryId: row.entry_id,
    capturedAt: row.captured_at,
    subscriberCount: row.subscriber_count,
    totalViewCount: row.total_view_count,
    videoCount: row.video_count,
    topPosts: row.top_posts as WatchlistSnapshot['topPosts'],
  };
}

function buildDeps(serviceClient: SupabaseClient<Database>) {
  return {
    youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
    scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
    rateLimitStore: createSupabaseRateLimitStore(serviceClient),
    ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
    hasActiveSubscription: (profileId: string) => hasActiveSubscription(serviceClient, profileId),
    countEntries: async (profileId: string) => {
      const { count, error } = await serviceClient
        .from('watchlist_entries')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId);
      if (error) throw new Error(`Failed to count watchlist entries: ${error.message}`);
      return count ?? 0;
    },
    insertEntry: async (params: { profileId: string; platform: WatchlistEntry['platform']; handle: string; url: string; label: string | null }) => {
      const { data, error } = await serviceClient
        .from('watchlist_entries')
        .insert({ profile_id: params.profileId, platform: params.platform, handle: params.handle, url: params.url, label: params.label })
        .select('*')
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        throw new DuplicateWatchlistEntryError();
      }
      if (error || !data) {
        throw new Error(`Failed to add watchlist entry: ${error?.message}`);
      }
      return mapEntryRow(data);
    },
    listEntries: async (profileId: string) => {
      const { data, error } = await serviceClient
        .from('watchlist_entries')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Failed to list watchlist entries: ${error.message}`);
      return (data ?? []).map(mapEntryRow);
    },
    getLatestSnapshot: async (entryId: string) => {
      const { data, error } = await serviceClient
        .from('watchlist_snapshots')
        .select('*')
        .eq('entry_id', entryId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch latest snapshot: ${error.message}`);
      return data ? mapSnapshotRow(data) : null;
    },
    getSnapshotAtOrBefore: async (entryId: string, cutoff: Date) => {
      const { data, error } = await serviceClient
        .from('watchlist_snapshots')
        .select('*')
        .eq('entry_id', entryId)
        .lte('captured_at', cutoff.toISOString())
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch historical snapshot: ${error.message}`);
      return data ? mapSnapshotRow(data) : null;
    },
    insertSnapshot: async (snapshot: WatchlistSnapshot) => {
      const { error } = await serviceClient.from('watchlist_snapshots').insert({
        entry_id: snapshot.entryId,
        captured_at: snapshot.capturedAt,
        subscriber_count: snapshot.subscriberCount,
        total_view_count: snapshot.totalViewCount,
        video_count: snapshot.videoCount,
        top_posts: snapshot.topPosts,
      });
      if (error) throw new Error(`Failed to save watchlist snapshot: ${error.message}`);
    },
    clearEntryError: async (entryId: string) => {
      const { error } = await serviceClient.from('watchlist_entries').update({ last_error: null }).eq('id', entryId);
      if (error) throw new Error(`Failed to clear watchlist entry error: ${error.message}`);
    },
    setEntryError: async (entryId: string, message: string) => {
      const { error } = await serviceClient.from('watchlist_entries').update({ last_error: message }).eq('id', entryId);
      if (error) throw new Error(`Failed to record watchlist entry error: ${error.message}`);
    },
  };
}

export async function GET(request: Request) {
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

  const result = await handleListWatchlist(buildDeps(serviceClient), { profileId: user?.id ?? null, ip, now: new Date() });
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

    const result = await handleAddWatchlistEntry(buildDeps(serviceClient), { profileId: user?.id ?? null, url, label });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Adding a watchlist entry failed:', err);
    return NextResponse.json({ error: 'Something went wrong adding that competitor. Please try again.' }, { status: 500 });
  }
}
