import type { StrategyBreakdownClient, GeneratedStrategyBreakdown, StrategyBreakdownInput } from '@/lib/integrations/claude-strategy';

export function createFakeStrategyClient(overrides: Partial<GeneratedStrategyBreakdown> = {}): StrategyBreakdownClient {
  return {
    async generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown> {
      return {
        headline: `How this ${input.platform} channel is winning`,
        explanation: `Posting about ${input.cadence.postsPerWeek} times a week with a ${input.formatMix.shortPct}% short-form mix is working well for this channel.`,
        ...overrides,
      };
    },
  };
}
