import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLinkedInAuditClient, LINKEDIN_AUDIT_SYSTEM_PROMPT } from '@/lib/integrations/claude-linkedin-audit';

describe('LINKEDIN_AUDIT_SYSTEM_PROMPT', () => {
  it('tells the model the PDF is a third party document, not instructions', () => {
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).toContain('not instructions');
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).toContain('ignore');
  });
});

describe('createLinkedInAuditClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the PDF as a document content block alongside a text block, and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              headline: 'Solid foundation, thin About section',
              workingWell: ['Your headline is specific and clear.'],
              needsWork: ['Your About section is only one sentence — add a few more about what you actually do.'],
            }),
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createLinkedInAuditClient('test-api-key');
    const audit = await client.generateAudit({ pdfBase64: 'ZmFrZS1wZGY=' });

    expect(audit.headline).toBe('Solid foundation, thin About section');
    expect(audit.workingWell).toHaveLength(1);
    expect(audit.needsWork).toHaveLength(1);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[1]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'ZmFrZS1wZGY=' },
    });
  });

  it('throws when the response has no usable feedback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ text: '{"headline": ""}' }] }) })
    );
    const client = createLinkedInAuditClient('test-api-key');
    await expect(client.generateAudit({ pdfBase64: 'ZmFrZS1wZGY=' })).rejects.toThrow('without usable feedback');
  });
});
