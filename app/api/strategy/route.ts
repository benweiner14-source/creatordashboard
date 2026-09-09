import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeStrategyClient } from '@/lib/integrations/claude-strategy';
import { deriveClientIp } from '@/lib/ip';
import { handleStrategyBreakdownRequest } from '@/lib/strategy/handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json(
      { error: 'Creator Strategy Breakdown requires an active subscription.', upgradeUrl: '/billing' },
      { status: 402 }
    );
  }

  // Most-recent-first, capped at 10 — a read-only "revisit an old breakdown"
  // list, not a paginated archive. See docs/superpowers/specs for the
  // deferred-then-added history-list follow-up.
  const { data: rows } = await serviceClient
    .from('strategy_breakdowns')
    .select('id, platform, channel_handle, headline, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const history = (rows ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    channelHandle: row.channel_handle,
    headline: row.headline,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ ok: true, history });
}

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: 'A channel or profile URL is required.' }, { status: 400 });
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

    const result = await handleStrategyBreakdownRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        claudeStrategyClient: createClaudeStrategyClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        saveStrategyBreakdown: async (params) => {
          const { data, error } = await serviceClient
            .from('strategy_breakdowns')
            .insert({
              profile_id: params.profileId,
              platform: params.platform,
              channel_handle: params.channelHandle,
              channel_url: params.channelUrl,
              post_count: params.postCount,
              cadence: params.cadence,
              format_mix: params.formatMix,
              top_posts: params.topPosts,
              headline: params.headline,
              explanation: params.explanation,
            })
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save strategy breakdown: ${error?.message}`);
          }
          return { id: data.id };
        },
      },
      { profileId: user?.id ?? null, ip, url }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Strategy breakdown generation failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong generating your strategy breakdown. Please try again.' },
      { status: 500 }
    );
  }
}
