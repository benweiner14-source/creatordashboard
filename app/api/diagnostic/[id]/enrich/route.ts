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
          const { data } = await serviceClient
            .from('diagnostics')
            .select('profile_id, platform, input_url, report_json')
            .eq('id', diagnosticId)
            .maybeSingle();
          if (!data) return null;
          const hookStrength = extractHookStrength(data.report_json);
          return {
            profileId: data.profile_id,
            platform: data.platform,
            inputUrl: data.input_url,
            hookStrengthScore: hookStrength.score,
            hookStrengthLabel: hookStrength.label,
          };
        },
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        frameExtractorClient: createApifyFrameExtractorClient(process.env.APIFY_API_TOKEN ?? ''),
        visualAudioClient: createClaudeVisualAudioClient(process.env.ANTHROPIC_API_KEY ?? ''),
        fetchImageAsBase64,
        saveEnrichment: async ({ diagnosticId, status, narrative, error }) => {
          await serviceClient
            .from('diagnostics')
            .update({
              visual_audio_status: status,
              visual_audio_narrative: narrative ?? null,
              visual_audio_error: error ?? null,
            })
            .eq('id', diagnosticId);
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
