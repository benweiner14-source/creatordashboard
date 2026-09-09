import type { LinkedInIdeasClient, LinkedInPostIdea } from '@/lib/integrations/claude-linkedin-ideas';

export function createFakeLinkedInIdeasClient(overrides: LinkedInPostIdea[] | null = null): LinkedInIdeasClient {
  return {
    async generateWeeklyIdeas(niche: string): Promise<LinkedInPostIdea[]> {
      if (overrides !== null) return overrides;
      return [
        {
          workingTitle: `A lesson from my work in ${niche}`,
          angle: 'Share one concrete, specific takeaway.',
          whyItFitsYourGoal: 'Demonstrates real expertise to the people you want noticing you.',
        },
      ];
    },
  };
}
