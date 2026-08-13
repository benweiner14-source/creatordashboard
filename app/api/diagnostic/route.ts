import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeReportClient } from '@/lib/integrations/claude';
import { handleDiagnosticRequest } from '@/lib/diagnostic/handler';
import { deriveClientIp } from '@/lib/ip';

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  if (!url) {
    return NextResponse.json({ error: 'A post or video URL is required.' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServerClient();
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
