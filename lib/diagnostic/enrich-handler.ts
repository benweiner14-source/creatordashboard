import type { ScraperClient } from '@/lib/integrations/scraper';
import type { FrameExtractorClient } from '@/lib/integrations/frame-extractor';
import { HOOK_WINDOW_TIMESTAMPS_SECONDS } from '@/lib/integrations/frame-extractor';
import type { ClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';

export interface DiagnosticForEnrichment {
  profileId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  inputUrl: string;
  hookStrengthScore: number;
  hookStrengthLabel: string;
}

export interface EnrichHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getDiagnostic: (id: string) => Promise<DiagnosticForEnrichment | null>;
  scraperClient: Pick<ScraperClient, 'fetchVideoForAnalysis'>;
  frameExtractorClient: FrameExtractorClient;
  visualAudioClient: ClaudeVisualAudioClient;
  fetchImageAsBase64: (url: string) => Promise<string>;
  saveEnrichment: (params: {
    diagnosticId: string;
    status: 'pending' | 'complete' | 'failed';
    narrative?: string;
    error?: string;
  }) => Promise<void>;
}

export interface EnrichRequestContext {
  profileId: string | null;
  diagnosticId: string;
}

export interface EnrichHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleEnrichRequest(
  deps: EnrichHandlerDeps,
  context: EnrichRequestContext
): Promise<EnrichHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run this analysis.' } };
  }

  const diagnostic = await deps.getDiagnostic(context.diagnosticId);
  if (!diagnostic) {
    return { status: 404, body: { error: 'Diagnostic not found.' } };
  }
  if (diagnostic.profileId !== context.profileId) {
    return { status: 403, body: { error: 'You do not have access to this diagnostic.' } };
  }
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Visual & Audio Analysis requires an active subscription.', upgradeUrl: '/billing' },
    };
  }
  // Both YouTube and Instagram are statically known unsupported today — decided
  // up front, before writing any status, so a request that can never resolve
  // to 'complete'/'failed' never gets left showing "in progress" forever. See
  // design spec §5 step 4.
  if (diagnostic.platform !== 'tiktok') {
    return { status: 422, body: { error: `Visual & Audio Analysis is not available for ${diagnostic.platform} yet.` } };
  }

  await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'pending' });

  try {
    const video = await deps.scraperClient.fetchVideoForAnalysis('tiktok', diagnostic.inputUrl);
    const frames = await deps.frameExtractorClient.extractFrames(video.videoUrl, HOOK_WINDOW_TIMESTAMPS_SECONDS);
    if (frames.length === 0) {
      const message = "Couldn't process this video — it may be too short or in an unsupported format.";
      await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
      return { status: 500, body: { error: message } };
    }

    const frameJpegBase64 = await Promise.all(frames.map((frame) => deps.fetchImageAsBase64(frame.imageUrl)));
    const analysis = await deps.visualAudioClient.analyzeVisualAudio({
      platform: diagnostic.platform,
      frameJpegBase64,
      transcript: video.transcript,
      hookStrengthScore: { value: diagnostic.hookStrengthScore, label: diagnostic.hookStrengthLabel },
    });

    await deps.saveEnrichment({
      diagnosticId: context.diagnosticId,
      status: 'complete',
      narrative: analysis.narrative,
    });
    return { status: 200, body: { narrative: analysis.narrative } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Visual/audio enrichment failed:', message);
    await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
    return { status: 500, body: { error: 'Something went wrong analyzing this video. Please try again.' } };
  }
}
