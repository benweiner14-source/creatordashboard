import type { LinkedInStrategyClient, GeneratedLinkedInStrategy, LinkedInStrategyInput } from '@/lib/integrations/claude-linkedin-strategy';

export function createFakeLinkedInStrategyClient(overrides: Partial<GeneratedLinkedInStrategy> = {}): LinkedInStrategyClient {
  return {
    async generateStrategy(input: LinkedInStrategyInput): Promise<GeneratedLinkedInStrategy> {
      return {
        headline: `A strategy for ${input.niche}`,
        contentPillars: ['Industry commentary', 'Behind-the-scenes wins'],
        postingCadenceRecommendation: 'Aim for 2-3 posts a week.',
        positioningNotes: `Position yourself around ${input.targetGoal}.`,
        ...overrides,
      };
    },
  };
}
