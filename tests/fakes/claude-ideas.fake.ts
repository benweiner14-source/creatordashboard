import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';

export function createFakeContentIdeasClient(ideas: ContentIdea[] = [DEFAULT_IDEA]): ContentIdeasClient {
  return {
    async generateContentIdeas(): Promise<ContentIdea[]> {
      return ideas;
    },
  };
}

const DEFAULT_IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};
