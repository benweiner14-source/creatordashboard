import { describe, it, expect, vi } from 'vitest';
import { handleEnrichRequest, type EnrichHandlerDeps, type DiagnosticForEnrichment } from '@/lib/diagnostic/enrich-handler';
import { PlatformNotSupportedError } from '@/lib/integrations/scraper';

function makeDeps(overrides: Partial<EnrichHandlerDeps> = {}): EnrichHandlerDeps {
  const diagnostic: DiagnosticForEnrichment = {
    profileId: 'profile-1',
    platform: 'tiktok',
    inputUrl: 'https://www.tiktok.com/@user/video/123',
    hookStrengthScore: 72,
    hookStrengthLabel: 'strong',
  };
  return {
    hasActiveSubscription: async () => true,
    getDiagnostic: async () => diagnostic,
    scraperClient: {
      fetchVideoForAnalysis: async () => ({
        videoUrl: 'https://api.apify.com/v2/key-value-stores/fake/records/video.mp4?token=fake',
        durationSeconds: 30,
        transcript: 'A fake transcript.',
      }),
    },
    frameExtractorClient: {
      extractFrames: async () => [
        { timestampSeconds: 0, imageUrl: 'https://example.com/frame-0.jpg' },
        { timestampSeconds: 0.5, imageUrl: 'https://example.com/frame-1.jpg' },
      ],
    },
    visualAudioClient: {
      analyzeVisualAudio: async () => ({ narrative: 'A clear, encouraging read of the hook.' }),
    },
    fetchImageAsBase64: async () => 'ZmFrZS1mcmFtZQ==',
    saveEnrichment: async () => {},
    ...overrides,
  };
}

describe('handleEnrichRequest', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleEnrichRequest(makeDeps(), { profileId: null, diagnosticId: 'diag-1' });
    expect(result.status).toBe(401);
  });

  it('returns 404 when the diagnostic does not exist', async () => {
    const deps = makeDeps({ getDiagnostic: async () => null });
    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(404);
  });

  it('returns 403 when the diagnostic belongs to a different profile', async () => {
    const deps = makeDeps();
    const result = await handleEnrichRequest(deps, { profileId: 'someone-else', diagnosticId: 'diag-1' });
    expect(result.status).toBe(403);
  });

  it('returns 402 with an upgrade URL when the profile has no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('returns 422 for a non-tiktok platform, without writing any status or calling any client', async () => {
    const saveEnrichment = vi.fn();
    const fetchVideoForAnalysis = vi.fn();
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'instagram',
        inputUrl: 'https://www.instagram.com/reel/abc/',
        hookStrengthScore: 50,
        hookStrengthLabel: 'moderate',
      }),
      scraperClient: { fetchVideoForAnalysis },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(422);
    expect(saveEnrichment).not.toHaveBeenCalled();
    expect(fetchVideoForAnalysis).not.toHaveBeenCalled();
  });

  it('writes pending then complete, and returns the narrative, on the happy path', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({ saveEnrichment });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(result.body.narrative).toBe('A clear, encouraging read of the hook.');
    expect(saveEnrichment).toHaveBeenCalledWith({ diagnosticId: 'diag-1', status: 'pending' });
    expect(saveEnrichment).toHaveBeenCalledWith({
      diagnosticId: 'diag-1',
      status: 'complete',
      narrative: 'A clear, encouraging read of the hook.',
    });
  });

  it('saves a failed status and returns a clear message when zero frames are extracted', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      frameExtractorClient: { extractFrames: async () => [] },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toContain("Couldn't process this video");
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' })
    );
  });

  it('saves a failed status and returns a generic message when a pipeline step throws', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchVideoForAnalysis: async () => {
          throw new Error('Apify video download failed with status 500');
        },
      },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong analyzing this video. Please try again.');
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed', error: 'Apify video download failed with status 500' })
    );
  });

  it('propagates PlatformNotSupportedError from fetchVideoForAnalysis as a clean failure, not a crash', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchVideoForAnalysis: async () => {
          throw new PlatformNotSupportedError('instagram');
        },
      },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' })
    );
  });
});
