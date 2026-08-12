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
Respond with a short headline (max 12 words) and a 3-5 sentence explanation.`;

export function createClaudeReportClient(apiKey: string, model = 'claude-sonnet-4-5'): ClaudeReportClient {
  return {
    async generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: DIAGNOSTIC_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Platform: ${input.platform}\nPost summary: ${input.postSummary}\nHook strength: ${input.scores.hookStrength.value} (${input.scores.hookStrength.label})\nRetention risk: ${input.scores.retentionRisk.value} (${input.scores.retentionRisk.label})\nTiming: ${input.scores.timing.value} (${input.scores.timing.label})\nFormat fit: ${input.scores.formatFit.value} (${input.scores.formatFit.label})\n\nRespond as JSON: {"headline": string, "explanation": string}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      let parsed: { headline?: string; explanation?: string };
      try {
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('Claude API returned a response that could not be parsed as JSON.');
      }
      return {
        headline: parsed.headline ?? 'Your diagnostic report',
        explanation: parsed.explanation ?? '',
      };
    },
  };
}
