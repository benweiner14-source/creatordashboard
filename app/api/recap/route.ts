import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { deriveClientIp } from '@/lib/ip';
import { handleRecapRequest } from '@/lib/recap/handler';
import type { RecapCardRow } from '@/lib/recap/types';

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

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

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your recap settings.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('youtube_channel_handle,tiktok_handle,instagram_handle')
    .eq('id', user.id)
    .single();

  const { data: existingCard } = await serviceClient
    .from('recap_cards')
    .select('id')
    .eq('profile_id', user.id)
    .eq('month', currentMonthKey(new Date()))
    .maybeSingle();

  return NextResponse.json({
    handles: {
      youtube: profile?.youtube_channel_handle ?? null,
      tiktok: profile?.tiktok_handle ?? null,
      instagram: profile?.instagram_handle ?? null,
    },
    recapCardId: existingCard?.id ?? null,
  });
}

export async function POST(request: Request) {
  try {
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

    const result = await handleRecapRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getProfileHandles: async (profileId) => {
          const { data } = await serviceClient
            .from('profiles')
            .select('youtube_channel_handle,tiktok_handle,instagram_handle')
            .eq('id', profileId)
            .single();
          return {
            youtube: data?.youtube_channel_handle ?? null,
            tiktok: data?.tiktok_handle ?? null,
            instagram: data?.instagram_handle ?? null,
          };
        },
        getExistingRecapCard: async (profileId, month) => {
          const { data } = await serviceClient
            .from('recap_cards')
            .select('*')
            .eq('profile_id', profileId)
            .eq('month', month)
            .maybeSingle();
          return data ? mapRecapCardRow(data) : null;
        },
        saveRecapCard: async ({ profileId, month, platformData, totals, topPost, warnings }) => {
          const { data, error } = await serviceClient
            .from('recap_cards')
            .insert({ profile_id: profileId, month, platform_data: platformData, totals, top_post: topPost, warnings })
            .select('*')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save recap card: ${error?.message}`);
          }
          return mapRecapCardRow(data);
        },
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Recap generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your recap card. Please try again.' }, { status: 500 });
  }
}
