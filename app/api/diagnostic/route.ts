import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeReportClient } from '@/lib/integrations/claude';
import { handleDiagnosticRequest } from '@/lib/diagnostic/handler';
import { deriveClientIp } from '@/lib/ip';

// Count-based window, not a calendar window -- matches this codebase's
// existing convention (e.g. Watchlist's "most recent ~50 uploads") and
// avoids an empty result for an infrequent poster. See
// lib/diagnostic/reach-history.ts.
const RECENT_REACH_SCORE_WINDOW = 20;

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  if (!url) {
    return NextResponse.json({ error: 'A post or video URL is required.' }, { status: 400 });
  }

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

    const result = await handleDiagnosticRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        claudeClient: createClaudeReportClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getRecentReachScores: async (profileId) => {
          const { data, error } = await serviceClient
            .from('diagnostics')
            .select('reach_score')
            .eq('profile_id', profileId)
            .not('reach_score', 'is', null)
            .order('created_at', { ascending: false })
            .limit(RECENT_REACH_SCORE_WINDOW);
          if (error) {
            // Never let a per-account history lookup fail the whole
            // diagnostic -- this is purely additive narrative context, same
            // reasoning as the YouTube subscriber-count lookup below.
            console.error('Failed to load recent Reach scores; omitting history context:', error.message);
            return [];
          }
          return (data ?? []).map((row) => row.reach_score).filter((score): score is number => score !== null);
        },
        saveDiagnostic: async ({ profileId, platform, inputUrl, report }) => {
          const { data, error } = await serviceClient
            .from('diagnostics')
            .insert({
              profile_id: profileId,
              platform,
              input_url: inputUrl,
              status: 'complete',
              hook_strength_score: report.scores.hookStrength.score,
              retention_risk_score: report.scores.retentionRisk.score,
              timing_score: report.scores.timing.score,
              format_fit_score: report.scores.formatFit.score,
              reach_score: report.scores.reach?.score ?? null,
              overall_score: report.scores.overallScore,
              report_json: report,
            })
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save diagnostic: ${error?.message}`);
          }
          return { id: data.id };
        },
      },
      { profileId: user?.id ?? null, ip, url }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Diagnostic request failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your report. Please try again.' }, { status: 500 });
  }
}
