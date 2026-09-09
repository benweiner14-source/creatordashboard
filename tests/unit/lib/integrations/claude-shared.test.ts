import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestClaudeJson } from '@/lib/integrations/claude-shared';

describe('requestClaudeJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still accepts a plain string userContent (existing callers)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"ok":true}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestClaudeJson<{ ok: boolean }>({
      apiKey: 'key',
      model: 'claude-sonnet-5',
      maxTokens: 100,
      system: 'sys',
      userContent: 'plain string',
    });

    expect(result).toEqual({ ok: true });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toBe('plain string');
  });

  it('accepts a content-block array (a text block plus a PDF document block) and forwards it verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"ok":true}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const blocks = [
      { type: 'text' as const, text: 'Read the attached PDF.' },
      { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'ZmFrZS1wZGY=' } },
    ];

    const result = await requestClaudeJson<{ ok: boolean }>({
      apiKey: 'key',
      model: 'claude-sonnet-5',
      maxTokens: 100,
      system: 'sys',
      userContent: blocks,
    });

    expect(result).toEqual({ ok: true });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toEqual(blocks);
  });
});
