import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { LinkedInAuditClient, GeneratedLinkedInAudit } from '@/lib/integrations/claude-linkedin-audit';

export const LINKEDIN_AUDIT_PROFILE_LIMIT = 5;
export const LINKEDIN_AUDIT_IP_LIMIT = 10;

export interface SavedLinkedInAudit extends GeneratedLinkedInAudit {
  id: string;
  createdAt: string;
}

export interface LinkedInAuditHandlerDeps {
  rateLimitStore: RateLimitStore;
  linkedInAuditClient: LinkedInAuditClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  saveAudit: (params: { profileId: string; audit: GeneratedLinkedInAudit }) => Promise<SavedLinkedInAudit>;
}

export interface LinkedInAuditRequestContext {
  profileId: string | null;
  ip: string;
  pdfBase64: string;
}

export interface LinkedInAuditHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleLinkedInAuditRequest(
  deps: LinkedInAuditHandlerDeps,
  context: LinkedInAuditRequestContext
): Promise<LinkedInAuditHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a profile audit.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'LinkedIn Content Strategy requires an active subscription.', upgradeUrl: '/billing' } };
  }

  if (!context.pdfBase64) {
    return { status: 400, body: { error: 'Upload a PDF of your LinkedIn profile first.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'linkedin_audit_generation',
    profileLimit: LINKEDIN_AUDIT_PROFILE_LIMIT,
    ipLimit: LINKEDIN_AUDIT_IP_LIMIT,
    windowDays: 1,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many profile audits have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for profile audits. Please try again tomorrow.",
      },
    };
  }

  try {
    const generated = await deps.linkedInAuditClient.generateAudit({ pdfBase64: context.pdfBase64 });
    const saved = await deps.saveAudit({ profileId: context.profileId, audit: generated });
    return { status: 200, body: { audit: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
