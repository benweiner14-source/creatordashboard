import type { ScraperClient } from '@/lib/integrations/scraper';
import type { FrameExtractorClient } from '@/lib/integrations/frame-extractor';
import { HOOK_WINDOW_TIMESTAMPS_SECONDS } from '@/lib/integrations/frame-extractor';
import type { ClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';

/** Persisted in visual_audio_error, which is read back by the client. Safe, user-facing text only. */
const GENERIC_FAILURE_MESSAGE = 'Something went wrong analyzing this video.';

export interface DiagnosticForEnrichment {
  profileId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  inputUrl: string;
  hookStrengthScore: number;
  hookStrengthLabel: string;
  visualAudioStatus: 'pending' | 'complete' | 'failed' | null;
  visualAudioNarrative: string | null;
  visualAudioIsEpisodic: boolean | null;
  visualAudioSeriesLabel: string | null;
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
    isEpisodic?: boolean;
    seriesLabel?: string | null;
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

  // Idempotency guard for a paid, ~$0.10-per-call pipeline: a refresh-and-click
  // (or a scripted loop) must not re-run the whole thing once an analysis has
  // already completed. Deliberately placed after the auth/entitlement checks
  // (so it can't be used to read someone else's narrative) but before the
  // 'pending' write (so it never clobbers a completed row's status).
  if (diagnostic.visualAudioStatus === 'complete') {
    return {
      status: 200,
      body: {
        narrative: diagnostic.visualAudioNarrative,
        isEpisodic: diagnostic.visualAudioIsEpisodic,
        seriesLabel: diagnostic.visualAudioSeriesLabel,
      },
    };
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

    // An empty narrative is a silent non-result: the report page's truthy check
    // on the narrative would render nothing, with no error and no retry path on
    // a call the user paid for. Treat it like the zero-frames case instead.
    if (analysis.narrative.trim().length === 0) {
      const message = "Couldn't generate an analysis for this video. Please try again.";
      await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
      return { status: 500, body: { error: message } };
    }

    await deps.saveEnrichment({
      diagnosticId: context.diagnosticId,
      status: 'complete',
      narrative: analysis.narrative,
      isEpisodic: analysis.isEpisodic,
      seriesLabel: analysis.seriesLabel,
    });
    return { status: 200, body: { narrative: analysis.narrative, isEpisodic: analysis.isEpisodic, seriesLabel: analysis.seriesLabel } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // The raw exception text stays in the server logs only. visual_audio_error
    // is surfaced verbatim to the client by GET /api/diagnostic/[id] (which
    // selects *), and internal error detail must never travel there — see
    // design spec's error-handling invariant.
    console.error('Visual/audio enrichment failed:', message);
    await deps.saveEnrichment({
      diagnosticId: context.diagnosticId,
      status: 'failed',
      error: GENERIC_FAILURE_MESSAGE,
    });
    return { status: 500, body: { error: 'Something went wrong analyzing this video. Please try again.' } };
  }
}
