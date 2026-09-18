import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeCommentAnalysisClient } from '@/lib/integrations/claude-comments';
import { handleCommentAnalysisRequest, type DiagnosticForCommentAnalysis } from '@/lib/diagnostic/comment-analysis-handler';

export const maxDuration = 60;

function extractHookStrength(reportJson: unknown): { score: number; label: string } {
  const report = reportJson as { scores?: { hookStrength?: { score: number; label: string } } } | null;
  return report?.scores?.hookStrength ?? { score: 0, label: 'weak' };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();

    const result = await handleCommentAnalysisRequest(
      {
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        getDiagnostic: async (diagnosticId): Promise<DiagnosticForCommentAnalysis | null> => {
          const { data, error } = await serviceClient
            .from('diagnostics')
            .select(
              'profile_id, platform, input_url, status, report_json, comment_analysis_status, comment_analysis_narrative, comment_analysis_has_content_request, comment_analysis_content_request_summary'
            )
            .eq('id', diagnosticId)
            .maybeSingle();
          if (error) {
            throw new Error(`Failed to load diagnostic: ${error.message}`);
          }
          if (!data) return null;
          // Without a complete base report there is no real Hook Strength score
          // to hand Claude — nothing valid to analyze, so treat it as not found.
          if (data.status !== 'complete') return null;
          const hookStrength = extractHookStrength(data.report_json);
          return {
            profileId: data.profile_id,
            platform: data.platform,
            inputUrl: data.input_url,
            hookStrengthScore: hookStrength.score,
            hookStrengthLabel: hookStrength.label,
            commentAnalysisStatus: data.comment_analysis_status ?? null,
            commentAnalysisNarrative: data.comment_analysis_narrative ?? null,
            commentAnalysisHasContentRequest: data.comment_analysis_has_content_request ?? null,
            commentAnalysisContentRequestSummary: data.comment_analysis_content_request_summary ?? null,
          };
        },
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        commentAnalysisClient: createClaudeCommentAnalysisClient(process.env.ANTHROPIC_API_KEY ?? ''),
        saveCommentAnalysis: async ({ diagnosticId, status, narrative, error, hasContentRequest, contentRequestSummary }) => {
          const { error: writeError } = await serviceClient
            .from('diagnostics')
            .update({
              comment_analysis_status: status,
              comment_analysis_narrative: narrative ?? null,
              comment_analysis_error: error ?? null,
              comment_analysis_has_content_request: hasContentRequest ?? null,
              comment_analysis_content_request_summary: contentRequestSummary ?? null,
            })
            .eq('id', diagnosticId);
          if (writeError) {
            throw new Error(`Failed to save comment analysis: ${writeError.message}`);
          }
        },
      },
      { profileId: user?.id ?? null, diagnosticId: id }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Comment analysis request failed:', err);
    return NextResponse.json({ error: 'Something went wrong analyzing these comments. Please try again.' }, { status: 500 });
  }
}
