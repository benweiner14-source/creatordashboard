import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLinkedInAuditClient, LINKEDIN_AUDIT_SYSTEM_PROMPT } from '@/lib/integrations/claude-linkedin-audit';

describe('LINKEDIN_AUDIT_SYSTEM_PROMPT', () => {
  it('tells the model the PDF is untrusted document content, not instructions', () => {
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).toContain('untrusted document content');
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).toContain('not instructions');
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).toContain('ignore');
  });

  it('never asserts whose profile the PDF is — the containment rule is about trust, not ownership', () => {
    // The prompt used to call the PDF "someone's own profile" in one place and
    // "a third party's profile" in another, which is a contradiction the model
    // has to resolve on its own. Neither claim is knowable or load-bearing.
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).not.toContain('third party');
    expect(LINKEDIN_AUDIT_SYSTEM_PROMPT.toLowerCase()).not.toContain("someone's own");
  });
});

describe('createLinkedInAuditClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the PDF as a document block ahead of the instructional text block, and parses the response', async () => {
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
    // Anthropic's guidance: the document block comes before the text that
    // refers to it.
    expect(content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'ZmFrZS1wZGY=' },
    });
    expect(content[1].type).toBe('text');
    // A truncated response throws and costs a paid call for nothing, so the
    // budget has to cover adaptive thinking plus a headline and two lists.
    expect(body.max_tokens).toBe(8192);
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
