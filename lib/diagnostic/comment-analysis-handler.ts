import type { ScraperClient } from '@/lib/integrations/scraper';
import type { ClaudeCommentAnalysisClient } from '@/lib/integrations/claude-comments';

/** Persisted in comment_analysis_error, which is read back by the client. Safe, user-facing text only. */
const GENERIC_FAILURE_MESSAGE = 'Something went wrong analyzing these comments.';

/** How many top comments (by like count) to send to Claude — keeps the prompt small and the cost predictable. */
export const COMMENT_ANALYSIS_LIMIT = 20;

export interface DiagnosticForCommentAnalysis {
  profileId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  inputUrl: string;
  hookStrengthScore: number;
  hookStrengthLabel: string;
  commentAnalysisStatus: 'pending' | 'complete' | 'failed' | null;
  commentAnalysisNarrative: string | null;
  commentAnalysisHasContentRequest: boolean | null;
  commentAnalysisContentRequestSummary: string | null;
}

export interface CommentAnalysisHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getDiagnostic: (id: string) => Promise<DiagnosticForCommentAnalysis | null>;
  scraperClient: Pick<ScraperClient, 'fetchComments'>;
  commentAnalysisClient: ClaudeCommentAnalysisClient;
  saveCommentAnalysis: (params: {
    diagnosticId: string;
    status: 'pending' | 'complete' | 'failed';
    narrative?: string;
    error?: string;
    hasContentRequest?: boolean;
    contentRequestSummary?: string | null;
  }) => Promise<void>;
}

export interface CommentAnalysisRequestContext {
  profileId: string | null;
  diagnosticId: string;
}

export interface CommentAnalysisHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleCommentAnalysisRequest(
  deps: CommentAnalysisHandlerDeps,
  context: CommentAnalysisRequestContext
): Promise<CommentAnalysisHandlerResult> {
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
      body: { error: 'Comment Analysis requires an active subscription.', upgradeUrl: '/billing' },
    };
  }

  // Idempotency guard, same rationale as Visual & Audio Content Analysis: a
  // refresh-and-click (or a scripted loop) must not re-run the whole thing
  // once an analysis has already completed.
  if (diagnostic.commentAnalysisStatus === 'complete') {
    return {
      status: 200,
      body: {
        narrative: diagnostic.commentAnalysisNarrative,
        hasContentRequest: diagnostic.commentAnalysisHasContentRequest,
        contentRequestSummary: diagnostic.commentAnalysisContentRequestSummary,
      },
    };
  }

  await deps.saveCommentAnalysis({ diagnosticId: context.diagnosticId, status: 'pending' });

  try {
    const comments = await deps.scraperClient.fetchComments(
      diagnostic.platform as 'tiktok' | 'instagram',
      diagnostic.inputUrl,
      COMMENT_ANALYSIS_LIMIT
    );
    const analysis = await deps.commentAnalysisClient.analyzeComments({
      platform: diagnostic.platform as 'tiktok' | 'instagram',
      comments,
      hookStrengthScore: { value: diagnostic.hookStrengthScore, label: diagnostic.hookStrengthLabel },
    });

    // An empty narrative is a silent non-result: the report page's truthy
    // check on the narrative would render nothing, with no error and no
    // retry path on a call the user paid for.
    if (analysis.narrative.trim().length === 0) {
      const message = "Couldn't generate an analysis for these comments. Please try again.";
      await deps.saveCommentAnalysis({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
      return { status: 500, body: { error: message } };
    }

    await deps.saveCommentAnalysis({
      diagnosticId: context.diagnosticId,
      status: 'complete',
      narrative: analysis.narrative,
      hasContentRequest: analysis.hasContentRequest,
      contentRequestSummary: analysis.contentRequestSummary,
    });
    return {
      status: 200,
      body: {
        narrative: analysis.narrative,
        hasContentRequest: analysis.hasContentRequest,
        contentRequestSummary: analysis.contentRequestSummary,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // The raw exception text stays in the server logs only. comment_analysis_error
    // is surfaced verbatim to the client by GET /api/diagnostic/[id] (which
    // selects *), and internal error detail must never travel there.
    console.error('Comment analysis failed:', message);
    await deps.saveCommentAnalysis({
      diagnosticId: context.diagnosticId,
      status: 'failed',
      error: GENERIC_FAILURE_MESSAGE,
    });
    return { status: 500, body: { error: 'Something went wrong analyzing these comments. Please try again.' } };
  }
}
