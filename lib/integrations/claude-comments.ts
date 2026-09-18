import { requestClaudeJson, escapeForContainmentTag, type ClaudeContentBlock } from './claude-shared';

export interface CommentAnalysisInput {
  platform: 'tiktok' | 'instagram';
  comments: Array<{ text: string; likeCount: number }>; // already sorted by likeCount desc and truncated by the caller
  hookStrengthScore: { value: number; label: string }; // existing fast-path score, for consistency
}

export interface CommentAnalysis {
  narrative: string;
  /** True when one or more comments make a specific, concrete request for future content. */
  hasContentRequest: boolean;
  /** A short summary of the request (e.g. "A pac-man island loot-only challenge video") -- null unless hasContentRequest is true. */
  contentRequestSummary: string | null;
}

export interface ClaudeCommentAnalysisClient {
  analyzeComments(input: CommentAnalysisInput): Promise<CommentAnalysis>;
}

export const COMMENT_ANALYSIS_SYSTEM_PROMPT = `You are the audience-comment reviewer for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
You are shown the real top comments on a post, ranked by how many likes each comment itself received (not the video's own likes), each wrapped in its own <comment likes="N"> tag.
Write a short, honest, plain-English read (3-5 sentences) of what the audience is actually saying: are they excited, confused, complaining about something specific, or asking questions? Comment count alone can't tell a creator this -- say something the raw number couldn't.
This creator already has a numeric Hook Strength score from engagement data alone (given below) -- use it only as context, don't just restate it.
Keep the tone encouraging but honest. Never claim to have read every comment on the post -- you only saw the ones given to you, already the most-liked.
Separately, check whether any comment makes a specific, concrete request for future content (e.g. "you should do a pac-man island loot only challenge", not a vague "more please"). Only report a request when it's genuinely specific -- do not invent one.`;

function formatComments(comments: Array<{ text: string; likeCount: number }>): string {
  if (comments.length === 0) return '(no comments were available for this post)';
  return comments
    .map((c) => `<comment likes="${c.likeCount}">${escapeForContainmentTag(c.text)}</comment>`)
    .join('\n');
}

export function createClaudeCommentAnalysisClient(apiKey: string, model = 'claude-sonnet-5'): ClaudeCommentAnalysisClient {
  return {
    async analyzeComments(input: CommentAnalysisInput): Promise<CommentAnalysis> {
      const content: ClaudeContentBlock[] = [
        {
          type: 'text',
          text: `Platform: ${input.platform}\nExisting Hook Strength score (from engagement data alone): ${input.hookStrengthScore.value} (${input.hookStrengthScore.label})\n\nTop comments, most-liked first:\n${formatComments(input.comments)}`,
        },
        {
          type: 'text',
          text: 'Respond as JSON: {"narrative": string, "hasContentRequest": boolean, "contentRequestSummary": string | null}. contentRequestSummary must be null unless hasContentRequest is true.',
        },
      ];
      const parsed = await requestClaudeJson<{ narrative?: string; hasContentRequest?: boolean; contentRequestSummary?: string | null }>({
        apiKey,
        model,
        maxTokens: 512,
        system: COMMENT_ANALYSIS_SYSTEM_PROMPT,
        userContent: content,
      });
      const hasContentRequest = parsed.hasContentRequest ?? false;
      return {
        narrative: parsed.narrative ?? '',
        hasContentRequest,
        contentRequestSummary: hasContentRequest ? (parsed.contentRequestSummary ?? null) : null,
      };
    },
  };
}
