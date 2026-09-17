import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';

describe('createClaudeVisualAudioClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one image block per frame, in order, plus the transcript and Hook Strength context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"narrative":"Strong opening frame with clear on-screen text."}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeVisualAudioClient('test-key');
    const result = await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZS1mcmFtZS0w', 'ZmFrZS1mcmFtZS0x'],
      transcript: 'You can actually play GTA 6 early.',
      hookStrengthScore: { value: 72, label: 'strong' },
    });

    expect(result.narrative).toBe('Strong opening frame with clear on-screen text.');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const content = body.messages[0].content as Array<Record<string, unknown>>;
    const imageBlocks = content.filter((b) => b.type === 'image');
    expect(imageBlocks).toHaveLength(2);
    expect((imageBlocks[0].source as { data: string }).data).toBe('ZmFrZS1mcmFtZS0w');
    expect((imageBlocks[1].source as { data: string }).data).toBe('ZmFrZS1mcmFtZS0x');
    const firstTextBlock = content[0].text as string;
    expect(firstTextBlock).toContain('Hook Strength score (from engagement data alone): 72 (strong)');
    expect(firstTextBlock).toContain('You can actually play GTA 6 early.');
  });

  it('phrases an absent transcript clearly instead of leaving it blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"narrative":"..."}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeVisualAudioClient('test-key');
    await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZQ=='],
      transcript: null,
      hookStrengthScore: { value: 50, label: 'moderate' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const firstTextBlock = body.messages[0].content[0].text as string;
    expect(firstTextBlock).toContain('(not available for this video)');
  });

  it('defaults to an empty narrative if the response omits it, rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{}' }] }),
    }));

    const client = createClaudeVisualAudioClient('test-key');
    const result = await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZQ=='],
      transcript: null,
      hookStrengthScore: { value: 50, label: 'moderate' },
    });

    expect(result.narrative).toBe('');
  });
});
