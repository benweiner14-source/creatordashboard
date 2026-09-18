import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createApifyFrameExtractorClient, fetchImageAsBase64 } from '@/lib/integrations/frame-extractor';
import { createClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';
import { handleEnrichRequest, type DiagnosticForEnrichment } from '@/lib/diagnostic/enrich-handler';

export const maxDuration = 60; // Hobby plan's real ceiling — see design spec decision 1.

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

    const result = await handleEnrichRequest(
      {
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        getDiagnostic: async (diagnosticId): Promise<DiagnosticForEnrichment | null> => {
          const { data, error } = await serviceClient
            .from('diagnostics')
            .select(
              'profile_id, platform, input_url, status, report_json, visual_audio_status, visual_audio_narrative, visual_audio_is_episodic, visual_audio_series_label'
            )
            .eq('id', diagnosticId)
            .maybeSingle();
          // A transient DB error must not masquerade as "no such diagnostic":
          // null here means 404, so only return it when the row genuinely
          // isn't there. The route's catch turns this throw into a 500.
          if (error) {
            throw new Error(`Failed to load diagnostic: ${error.message}`);
          }
          if (!data) return null;
          // Without a complete base report there is no real Hook Strength score
          // to hand Claude — extractHookStrength would silently fabricate a
          // {0, 'weak'}. Nothing valid to enrich, so treat it as not found.
          if (data.status !== 'complete') return null;
          const hookStrength = extractHookStrength(data.report_json);
          return {
            profileId: data.profile_id,
            platform: data.platform,
            inputUrl: data.input_url,
            hookStrengthScore: hookStrength.score,
            hookStrengthLabel: hookStrength.label,
            visualAudioStatus: data.visual_audio_status ?? null,
            visualAudioNarrative: data.visual_audio_narrative ?? null,
            visualAudioIsEpisodic: data.visual_audio_is_episodic ?? null,
            visualAudioSeriesLabel: data.visual_audio_series_label ?? null,
          };
        },
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        frameExtractorClient: createApifyFrameExtractorClient(process.env.APIFY_API_TOKEN ?? ''),
        visualAudioClient: createClaudeVisualAudioClient(process.env.ANTHROPIC_API_KEY ?? ''),
        fetchImageAsBase64,
        saveEnrichment: async ({ diagnosticId, status, narrative, error, isEpisodic, seriesLabel }) => {
          const { error: writeError } = await serviceClient
            .from('diagnostics')
            .update({
              visual_audio_status: status,
              visual_audio_narrative: narrative ?? null,
              visual_audio_error: error ?? null,
              visual_audio_is_episodic: isEpisodic ?? null,
              visual_audio_series_label: seriesLabel ?? null,
            })
            .eq('id', diagnosticId);
          // A dropped write here means the user sees the narrative once in the
          // optimistic response and never again — the row stays at 'pending'.
          // Surface it instead (the route's catch turns it into a 500).
          if (writeError) {
            throw new Error(`Failed to save visual/audio enrichment: ${writeError.message}`);
          }
        },
      },
      { profileId: user?.id ?? null, diagnosticId: id }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Visual/audio enrichment request failed:', err);
    return NextResponse.json({ error: 'Something went wrong analyzing this video. Please try again.' }, { status: 500 });
  }
}
