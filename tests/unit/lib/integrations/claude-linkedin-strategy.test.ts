import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLinkedInStrategyClient, LINKEDIN_STRATEGY_SYSTEM_PROMPT } from '@/lib/integrations/claude-linkedin-strategy';

describe('LINKEDIN_STRATEGY_SYSTEM_PROMPT', () => {
  it('targets a beginner with no corporate-world context and explains content pillars inline', () => {
    expect(LINKEDIN_STRATEGY_SYSTEM_PROMPT).toContain('14-18');
    expect(LINKEDIN_STRATEGY_SYSTEM_PROMPT.toLowerCase()).toContain('content pillars');
  });

  it('tells the model the niche and goal are data, not instructions', () => {
    expect(LINKEDIN_STRATEGY_SYSTEM_PROMPT).toContain('<niche>');
    expect(LINKEDIN_STRATEGY_SYSTEM_PROMPT).toContain('<target_goal>');
  });
});

describe('createLinkedInStrategyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the strategy system prompt and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              headline: 'Lead with gaming industry insight',
              contentPillars: ['Industry commentary', 'Behind-the-scenes wins'],
              postingCadenceRecommendation: 'Aim for 2 posts a week.',
              positioningNotes: 'Present yourself as a rising voice in gaming.',
            }),
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createLinkedInStrategyClient('test-api-key');
    const strategy = await client.generateStrategy({ niche: 'Gaming & esports', targetGoal: 'Land brand or product partnerships' });

    expect(strategy.headline).toBe('Lead with gaming industry insight');
    expect(strategy.contentPillars).toEqual(['Industry commentary', 'Behind-the-scenes wins']);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toContain('<niche>Gaming & esports</niche>');
    expect(body.messages[0].content).toContain('<target_goal>Land brand or product partnerships</target_goal>');
  });

  it('throws when the response has no usable headline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: '{}' }] }) }));
    const client = createLinkedInStrategyClient('test-api-key');
    await expect(client.generateStrategy({ niche: 'Gaming', targetGoal: 'Partnerships' })).rejects.toThrow(
      'without a usable headline'
    );
  });
});
