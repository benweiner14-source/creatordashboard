import { describe, it, expect, vi } from 'vitest';
import {
  handleCommentAnalysisRequest,
  type CommentAnalysisHandlerDeps,
  type DiagnosticForCommentAnalysis,
} from '@/lib/diagnostic/comment-analysis-handler';

function makeDeps(overrides: Partial<CommentAnalysisHandlerDeps> = {}): CommentAnalysisHandlerDeps {
  const diagnostic: DiagnosticForCommentAnalysis = {
    profileId: 'profile-1',
    platform: 'tiktok',
    inputUrl: 'https://www.tiktok.com/@user/video/123',
    hookStrengthScore: 72,
    hookStrengthLabel: 'strong',
    commentAnalysisStatus: null,
    commentAnalysisNarrative: null,
    commentAnalysisHasContentRequest: null,
    commentAnalysisContentRequestSummary: null,
  };
  return {
    hasActiveSubscription: async () => true,
    getDiagnostic: async () => diagnostic,
    scraperClient: {
      fetchComments: async () => [
        { text: 'GTA needs a movie', likeCount: 41752 },
        { text: 'Best use of Ai', likeCount: 26061 },
      ],
    },
    commentAnalysisClient: {
      analyzeComments: async () => ({
        narrative: 'Your audience loves this.',
        hasContentRequest: false,
        contentRequestSummary: null,
      }),
    },
    saveCommentAnalysis: async () => {},
    ...overrides,
  };
}

describe('handleCommentAnalysisRequest', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleCommentAnalysisRequest(makeDeps(), { profileId: null, diagnosticId: 'diag-1' });
    expect(result.status).toBe(401);
  });

  it('returns 404 when the diagnostic does not exist', async () => {
    const deps = makeDeps({ getDiagnostic: async () => null });
    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(404);
  });

  it('returns 403 when the diagnostic belongs to a different profile', async () => {
    const deps = makeDeps();
    const result = await handleCommentAnalysisRequest(deps, { profileId: 'someone-else', diagnosticId: 'diag-1' });
    expect(result.status).toBe(403);
  });

  it('returns 402 with an upgrade URL when the profile has no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('works for instagram as well as tiktok — comment analysis has no video-download restriction', async () => {
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'instagram',
        inputUrl: 'https://www.instagram.com/reel/abc/',
        hookStrengthScore: 60,
        hookStrengthLabel: 'moderate',
        commentAnalysisStatus: null,
        commentAnalysisNarrative: null,
        commentAnalysisHasContentRequest: null,
        commentAnalysisContentRequestSummary: null,
      }),
    });
    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(200);
  });

  it('writes pending then complete, and returns the narrative, on the happy path', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({ saveCommentAnalysis });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(result.body.narrative).toBe('Your audience loves this.');
    expect(saveCommentAnalysis).toHaveBeenCalledWith({ diagnosticId: 'diag-1', status: 'pending' });
    expect(saveCommentAnalysis).toHaveBeenCalledWith({
      diagnosticId: 'diag-1',
      status: 'complete',
      narrative: 'Your audience loves this.',
      hasContentRequest: false,
      contentRequestSummary: null,
    });
  });

  it('threads hasContentRequest/contentRequestSummary through to the save and the response body', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      commentAnalysisClient: {
        analyzeComments: async () => ({
          narrative: 'Several viewers are asking for a follow-up.',
          hasContentRequest: true,
          contentRequestSummary: 'A pac-man island loot-only challenge video',
        }),
      },
      saveCommentAnalysis,
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(result.body.hasContentRequest).toBe(true);
    expect(result.body.contentRequestSummary).toBe('A pac-man island loot-only challenge video');
    expect(saveCommentAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        hasContentRequest: true,
        contentRequestSummary: 'A pac-man island loot-only challenge video',
      })
    );
  });

  it('short-circuits with the stored result when an analysis already completed', async () => {
    const analyzeComments = vi.fn();
    const fetchComments = vi.fn();
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'tiktok',
        inputUrl: 'https://www.tiktok.com/@user/video/123',
        hookStrengthScore: 72,
        hookStrengthLabel: 'strong',
        commentAnalysisStatus: 'complete',
        commentAnalysisNarrative: 'An analysis we already paid for.',
        commentAnalysisHasContentRequest: true,
        commentAnalysisContentRequestSummary: 'More Pac-Man challenges',
      }),
      scraperClient: { fetchComments },
      commentAnalysisClient: { analyzeComments },
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(result.body.narrative).toBe('An analysis we already paid for.');
    expect(result.body.hasContentRequest).toBe(true);
    expect(result.body.contentRequestSummary).toBe('More Pac-Man challenges');
    expect(fetchComments).not.toHaveBeenCalled();
    expect(analyzeComments).not.toHaveBeenCalled();
  });

  it('still requires ownership before serving an already-complete result', async () => {
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'tiktok',
        inputUrl: 'https://www.tiktok.com/@user/video/123',
        hookStrengthScore: 72,
        hookStrengthLabel: 'strong',
        commentAnalysisStatus: 'complete',
        commentAnalysisNarrative: 'Somebody else’s analysis.',
        commentAnalysisHasContentRequest: false,
        commentAnalysisContentRequestSummary: null,
      }),
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'someone-else', diagnosticId: 'diag-1' });

    expect(result.status).toBe(403);
  });

  it('re-runs the pipeline when a previous attempt is stuck at pending', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'tiktok',
        inputUrl: 'https://www.tiktok.com/@user/video/123',
        hookStrengthScore: 72,
        hookStrengthLabel: 'strong',
        commentAnalysisStatus: 'pending',
        commentAnalysisNarrative: null,
        commentAnalysisHasContentRequest: null,
        commentAnalysisContentRequestSummary: null,
      }),
      saveCommentAnalysis,
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(saveCommentAnalysis).toHaveBeenCalledWith({ diagnosticId: 'diag-1', status: 'pending' });
  });

  it('proceeds even when there are zero comments, since formatComments phrases that clearly', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      scraperClient: { fetchComments: async () => [] },
      saveCommentAnalysis,
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(saveCommentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }));
  });

  it('saves a failed status and returns a clear message when Claude returns an empty narrative', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      commentAnalysisClient: {
        analyzeComments: async () => ({ narrative: '   ', hasContentRequest: false, contentRequestSummary: null }),
      },
      saveCommentAnalysis,
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toContain("Couldn't generate an analysis");
    expect(saveCommentAnalysis).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }));
    expect(saveCommentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' }));
  });

  it('saves a failed status and returns a generic message when a pipeline step throws', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchComments: async () => {
          throw new Error('Apify comments scrape failed with status 500');
        },
      },
      saveCommentAnalysis,
    });

    const result = await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong analyzing these comments. Please try again.');
    expect(saveCommentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' }));
  });

  it('persists a generic message, never the raw exception text, on a pipeline failure', async () => {
    const saveCommentAnalysis = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchComments: async () => {
          throw new Error('Apify comments scrape failed with status 500');
        },
      },
      saveCommentAnalysis,
    });

    await handleCommentAnalysisRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    const failedCall = saveCommentAnalysis.mock.calls.find((call) => call[0].status === 'failed');
    expect(failedCall).toBeDefined();
    expect(failedCall![0].error).toBe('Something went wrong analyzing these comments.');
    expect(failedCall![0].error).not.toContain('Apify');
  });
});
