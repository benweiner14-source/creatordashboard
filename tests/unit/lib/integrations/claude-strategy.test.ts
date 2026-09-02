import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeStrategyClient, STRATEGY_BREAKDOWN_SYSTEM_PROMPT } from '@/lib/integrations/claude-strategy';

describe('STRATEGY_BREAKDOWN_SYSTEM_PROMPT', () => {
  it('requires explaining why, in plain English', () => {
    expect(STRATEGY_BREAKDOWN_SYSTEM_PROMPT).toContain('WHY');
    expect(STRATEGY_BREAKDOWN_SYSTEM_PROMPT.toLowerCase()).toContain('plain english');
  });
});

const BASE_INPUT = {
  platform: 'tiktok' as const,
  channelHandle: 'creator',
  cadence: { postCount: 10, spanDays: 30, postsPerWeek: 2.3, mostCommonDayOfWeek: 'Tuesday' },
  formatMix: { averageDurationSeconds: 40, shortPct: 80, mediumPct: 20, longPct: 0 },
  averageEngagementRate: 0.08,
  topPosts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
};

describe('createClaudeStrategyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the strategy system prompt and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: JSON.stringify({ headline: 'Short, frequent posts are winning', explanation: 'This channel posts often because...' }) }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeStrategyClient('test-api-key');
    const result = await client.generateStrategyBreakdown(BASE_INPUT);

    expect(result.headline).toBe('Short, frequent posts are winning');
    expect(result.explanation).toContain('posts often');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe(STRATEGY_BREAKDOWN_SYSTEM_PROMPT);
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createClaudeStrategyClient('test-api-key');
    await expect(client.generateStrategyBreakdown(BASE_INPUT)).rejects.toThrow('Claude API request failed');
  });

  it('strips markdown code fences before parsing the JSON response', async () => {
    const fenced = '```json\n' + JSON.stringify({ headline: 'Fenced headline', explanation: 'Fenced explanation' }) + '\n```';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: fenced }] }) }));

    const client = createClaudeStrategyClient('test-api-key');
    const result = await client.generateStrategyBreakdown(BASE_INPUT);

    expect(result.headline).toBe('Fenced headline');
    expect(result.explanation).toBe('Fenced explanation');
  });

  it('throws a descriptive error when the response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: 'Sorry, cannot help.' }] }) })
    );
    const client = createClaudeStrategyClient('test-api-key');
    await expect(client.generateStrategyBreakdown(BASE_INPUT)).rejects.toThrow(
      'Claude API returned a response that could not be parsed as JSON.'
    );
  });
});
