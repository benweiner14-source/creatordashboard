// tests/unit/lib/linkedin/audit-handler.test.ts
import { describe, it, expect } from 'vitest';
import { handleLinkedInAuditRequest, LINKEDIN_AUDIT_PROFILE_LIMIT } from '@/lib/linkedin/audit-handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeLinkedInAuditClient } from '../../../fakes/claude-linkedin-audit.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleLinkedInAuditRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    linkedInAuditClient: createFakeLinkedInAuditClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    saveAudit: async ({ profileId, audit }: any) => ({ id: 'audit-1', createdAt: '2026-09-09T00:00:00Z', ...audit }),
    ...overrides,
  };
}

describe('handleLinkedInAuditRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleLinkedInAuditRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleLinkedInAuditRequest(deps, { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
    expect(result.status).toBe(402);
  });

  it('rejects an empty PDF payload', async () => {
    const result = await handleLinkedInAuditRequest(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', pdfBase64: '' });
    expect(result.status).toBe(400);
  });

  it('returns a generated audit on success', async () => {
    const result = await handleLinkedInAuditRequest(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
    expect(result.status).toBe(200);
    expect((result.body.audit as any).id).toBe('audit-1');
  });

  it(`rate-limits after ${LINKEDIN_AUDIT_PROFILE_LIMIT} requests from the same profile in a day`, async () => {
    const deps = makeDeps();
    for (let i = 0; i < LINKEDIN_AUDIT_PROFILE_LIMIT; i++) {
      const result = await handleLinkedInAuditRequest(deps, { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
      expect(result.status).toBe(200);
    }
    const blocked = await handleLinkedInAuditRequest(deps, { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
    expect(blocked.status).toBe(429);
  });

  it('releases the rate-limit slot when generation throws', async () => {
    // Looping to the profile limit before flipping the stub is load-bearing:
    // it's the only way the final call's 200 can prove the release actually
    // happened, rather than merely landing below a limit it was nowhere
    // near reaching.
    let failing = true;
    const deps = makeDeps({
      linkedInAuditClient: {
        generateAudit: async (input) => {
          if (failing) throw new Error('Claude API request failed with status 500');
          return createFakeLinkedInAuditClient().generateAudit(input);
        },
      },
    });

    for (let i = 0; i < LINKEDIN_AUDIT_PROFILE_LIMIT; i++) {
      await expect(
        handleLinkedInAuditRequest(deps, { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' })
      ).rejects.toThrow('Claude API request failed');
    }

    // Every one of the LINKEDIN_AUDIT_PROFILE_LIMIT throws above released its
    // slot — if it hadn't, the profile limit would already be exhausted and
    // this call would 429, not 200.
    failing = false;
    const retry = await handleLinkedInAuditRequest(deps, { profileId: 'p1', ip: '203.0.113.1', pdfBase64: 'ZmFrZQ==' });
    expect(retry.status).toBe(200);
  });
});
