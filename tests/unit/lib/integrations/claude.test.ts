import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeReportClient, DIAGNOSTIC_SYSTEM_PROMPT } from '@/lib/integrations/claude';

describe('DIAGNOSTIC_SYSTEM_PROMPT', () => {
  it('requires every score to be explained with a why', () => {
    expect(DIAGNOSTIC_SYSTEM_PROMPT).toContain('WHY');
    expect(DIAGNOSTIC_SYSTEM_PROMPT.toLowerCase()).toContain('plain english');
  });
});

describe('createClaudeReportClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the diagnostic system prompt and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: JSON.stringify({ headline: 'Strong hook, weak finish', explanation: 'Your hook rate is high because...' }) }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeReportClient('test-api-key');
    const report = await client.generateDiagnosticReport({
      platform: 'youtube',
      postSummary: 'A 3 minute tutorial about hooks',
      scores: {
        hookStrength: { value: 80, label: 'strong' },
        retentionRisk: { value: 40, label: 'moderate' },
        timing: { value: 60, label: 'moderate' },
        formatFit: { value: 90, label: 'strong' },
      },
    });

    expect(report.headline).toBe('Strong hook, weak finish');
    expect(report.explanation).toContain('hook rate');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe(DIAGNOSTIC_SYSTEM_PROMPT);
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createClaudeReportClient('test-api-key');
    await expect(
      client.generateDiagnosticReport({
        platform: 'youtube',
        postSummary: 'x',
        scores: {
          hookStrength: { value: 1, label: 'weak' },
          retentionRisk: { value: 1, label: 'weak' },
          timing: { value: 1, label: 'weak' },
          formatFit: { value: 1, label: 'weak' },
        },
      })
    ).rejects.toThrow('Claude API request failed');
  });
});
