import { requestClaudeJson } from './claude-shared';

export interface ReportScoreSummary {
  value: number;
  label: string;
}

export interface ReportGenerationInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postSummary: string;
  scores: {
    hookStrength: ReportScoreSummary;
    retentionRisk: ReportScoreSummary;
    timing: ReportScoreSummary;
    formatFit: ReportScoreSummary;
  };
}

export interface GeneratedReport {
  headline: string;
  explanation: string;
}

export interface ClaudeReportClient {
  generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport>;
}

export const DIAGNOSTIC_SYSTEM_PROMPT = `You are the report-writing engine for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
Write in plain English for a 16-24 year old creator who does not know terms like "retention" or "hook rate".
For every score you mention, you MUST explain WHY it is what it is in cause-and-effect terms the creator can act on.
Never state a score without a "why" explanation directly next to it.
Keep the tone encouraging but honest. Avoid jargon; when a technical term is unavoidable, use its plain name (hook rate, retention, engagement rate, format fit, posting window).

Ground your explanations in how each platform's algorithm actually behaves, without naming a data source by name:
- TikTok: finishing a video start-to-finish is one of the strongest interest signals TikTok's algorithm uses; the first 2 seconds decide most of a video's retention.
- Instagram: watch time, likes, and shares are Instagram's primary ranking signals for Reels; most viewers decide whether to keep watching within the first 3 seconds.
- YouTube: videos that lose most viewers before the 40% mark tend to get deprioritized; the platform starts rewarding videos with better suggested placement after the 8-minute mark for long-form content.

Respond with a short headline (max 12 words) and a 3-5 sentence explanation.`;

export function createClaudeReportClient(apiKey: string, model = 'claude-sonnet-4-5'): ClaudeReportClient {
  return {
    async generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport> {
      const parsed = await requestClaudeJson<{ headline?: string; explanation?: string }>({
        apiKey,
        model,
        maxTokens: 512,
        system: DIAGNOSTIC_SYSTEM_PROMPT,
        userContent: `Platform: ${input.platform}\nPost summary: ${input.postSummary}\nHook strength: ${input.scores.hookStrength.value} (${input.scores.hookStrength.label})\nRetention risk: ${input.scores.retentionRisk.value} (${input.scores.retentionRisk.label})\nTiming: ${input.scores.timing.value} (${input.scores.timing.label})\nFormat fit: ${input.scores.formatFit.value} (${input.scores.formatFit.label})\n\nRespond as JSON: {"headline": string, "explanation": string}`,
      });
      return {
        headline: parsed.headline ?? 'Your diagnostic report',
        explanation: parsed.explanation ?? '',
      };
    },
  };
}
