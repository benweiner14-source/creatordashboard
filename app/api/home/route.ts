// app/api/home/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { weekStartKey } from '@/lib/ideas/handler';
import type { PlatformTotals, RecapPlatform, RecapTopPost } from '@/lib/recap/types';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';
import type { HomeData } from '@/lib/home/types';

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your dashboard.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const now = new Date();

  const [{ data: profile }, { data: diagnosticRow }, { data: recapRow }, { data: digestRow }] = await Promise.all([
    serviceClient.from('profiles').select('niche').eq('id', user.id).single(),
    serviceClient
      .from('diagnostics')
      .select(
        'id, platform, overall_score, hook_strength_score, retention_risk_score, timing_score, format_fit_score, created_at'
      )
      .eq('profile_id', user.id)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from('recap_cards')
      .select('id, month, totals, platform_data, top_post, generated_at')
      .eq('profile_id', user.id)
      .eq('month', currentMonthKey(now))
      .maybeSingle(),
    serviceClient
      .from('weekly_digests')
      .select('week_start, content_ideas')
      .eq('profile_id', user.id)
      .eq('week_start', weekStartKey(now))
      .maybeSingle(),
  ]);

  const contentIdeas = (digestRow?.content_ideas as ContentIdea[] | null) ?? null;

  const homeData: HomeData = {
    email: user.email ?? '',
    diagnostic: diagnosticRow
      ? {
          id: diagnosticRow.id,
          platform: diagnosticRow.platform,
          overallScore: diagnosticRow.overall_score ?? 0,
          hookStrengthScore: diagnosticRow.hook_strength_score ?? 0,
          retentionRiskScore: diagnosticRow.retention_risk_score ?? 0,
          timingScore: diagnosticRow.timing_score ?? 0,
          formatFitScore: diagnosticRow.format_fit_score ?? 0,
          createdAt: diagnosticRow.created_at,
        }
      : null,
    recap: recapRow
      ? {
          id: recapRow.id,
          month: recapRow.month,
          totals: recapRow.totals as PlatformTotals,
          platformData: recapRow.platform_data as Partial<Record<RecapPlatform, PlatformTotals>>,
          topPost: recapRow.top_post as RecapTopPost,
          generatedAt: recapRow.generated_at,
        }
      : null,
    ideas: {
      niche: profile?.niche ?? null,
      digest:
        contentIdeas && contentIdeas.length > 0
          ? {
              weekStart: digestRow!.week_start,
              ideaCount: contentIdeas.length,
              firstIdeaTitle: contentIdeas[0].workingTitle,
            }
          : null,
    },
  };

  return NextResponse.json(homeData);
}
