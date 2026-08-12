import type { ClaudeReportClient, GeneratedReport, ReportGenerationInput } from '@/lib/integrations/claude';

export function createFakeClaudeReportClient(overrides: Partial<GeneratedReport> = {}): ClaudeReportClient {
  return {
    async generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport> {
      return {
        headline: `Your ${input.platform} post scored ${input.scores.hookStrength.label} on hook strength`,
        explanation: `Your hook rate looks ${input.scores.hookStrength.label} because of early engagement. Retention risk is ${input.scores.retentionRisk.label}. Your posting window timing was ${input.scores.timing.label}, and format fit was ${input.scores.formatFit.label}.`,
        ...overrides,
      };
    },
  };
}
