import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';
import type { EmailClient } from '@/lib/integrations/resend';
import { renderWeeklyDigestEmail } from '@/lib/email/weekly-digest-template';
import { weekStartKey } from '@/lib/ideas/handler';
import { generateUnsubscribeToken } from '@/lib/digest/unsubscribe-token';

export const WEEKLY_DIGEST_RUN_CAP = 200;

export interface DigestCandidate {
  profileId: string;
  email: string;
  niche: string;
}

export interface DigestRow {
  id: string;
  profileId: string;
  weekStart: string;
  contentIdeas: ContentIdea[];
  sentAt: string | null;
}

export interface CronHandlerDeps {
  getOptedInCandidates: (limit: number) => Promise<DigestCandidate[]>;
  getExistingDigest: (profileId: string, weekStart: string) => Promise<DigestRow | null>;
  saveDigest: (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => Promise<DigestRow>;
  markDigestSent: (digestId: string, sentAt: Date) => Promise<void>;
  markProfileDigestSent: (profileId: string, sentAt: Date) => Promise<void>;
  contentIdeasClient: ContentIdeasClient;
  emailClient: EmailClient;
  unsubscribeSecret: string;
  appUrl: string;
}

export interface CronRunResult {
  sent: string[];
  skipped: string[];
  failed: string[];
}

export function buildUnsubscribeUrl(profileId: string, secret: string, appUrl: string): string {
  const token = generateUnsubscribeToken(profileId, secret);
  return `${appUrl}/api/digest/unsubscribe?profile=${encodeURIComponent(profileId)}&token=${token}`;
}

/**
 * One serial pass over opted-in candidates (Approach A — see
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §7 for
 * why a queue is deliberately out of scope for v1). Every candidate is
 * wrapped in its own try/catch so one failure never aborts the run.
 */
export async function runWeeklyDigestCron(deps: CronHandlerDeps, now: Date): Promise<CronRunResult> {
  const weekStart = weekStartKey(now);
  const candidates = await deps.getOptedInCandidates(WEEKLY_DIGEST_RUN_CAP);
  const result: CronRunResult = { sent: [], skipped: [], failed: [] };

  for (const candidate of candidates) {
    try {
      let digest = await deps.getExistingDigest(candidate.profileId, weekStart);

      if (digest && digest.sentAt) {
        // Already fully handled this week — guards a duplicate cron
        // trigger from re-emailing everyone.
        result.skipped.push(candidate.profileId);
        continue;
      }

      if (!digest) {
        const ideas = await deps.contentIdeasClient.generateContentIdeas(candidate.niche, now);
        if (ideas.length === 0) {
          // A real generation ran and genuinely found nothing honest for
          // this niche this week — not a failure, same rule as the
          // on-demand path. No row written, no email sent.
          result.skipped.push(candidate.profileId);
          continue;
        }
        digest = await deps.saveDigest({ profileId: candidate.profileId, weekStart, contentIdeas: ideas });
      }

      const { subject, html } = renderWeeklyDigestEmail({
        niche: candidate.niche,
        weekStart,
        ideas: digest.contentIdeas,
        unsubscribeUrl: buildUnsubscribeUrl(candidate.profileId, deps.unsubscribeSecret, deps.appUrl),
      });
      await deps.emailClient.sendEmail({ to: candidate.email, subject, html });
      await deps.markDigestSent(digest.id, now);
      await deps.markProfileDigestSent(candidate.profileId, now);
      result.sent.push(candidate.profileId);
    } catch (err) {
      console.error(`Weekly digest failed for profile ${candidate.profileId}:`, err);
      result.failed.push(candidate.profileId);
    }
  }

  return result;
}
