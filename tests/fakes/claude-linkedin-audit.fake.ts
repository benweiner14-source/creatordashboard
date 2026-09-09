import type { LinkedInAuditClient, GeneratedLinkedInAudit } from '@/lib/integrations/claude-linkedin-audit';

export function createFakeLinkedInAuditClient(overrides: Partial<GeneratedLinkedInAudit> = {}): LinkedInAuditClient {
  return {
    async generateAudit(): Promise<GeneratedLinkedInAudit> {
      return {
        headline: 'Solid start, a couple of easy fixes',
        workingWell: ['Your headline is specific and clear.'],
        needsWork: ['Your About section is thin — add a few more sentences about what you actually do.'],
        ...overrides,
      };
    },
  };
}
