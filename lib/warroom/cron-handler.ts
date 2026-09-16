import type { EmailClient } from '@/lib/integrations/resend';
import { classifySeverity } from './scoring';
import type { DiscoveredPost, DiscoveryResult, WarroomSeverity } from './types';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';
}

/** Reused verbatim from the reference Social War Room system — design spec §4. */
const BUDGET_EXCEEDED_RE = /hard limit exceeded|platform-feature-disabled|monthly usage/i;

export const WARROOM_DAILY_ALERT_CAP = 30;
export const WARROOM_PER_RUN_CAP = 5;

export interface WarroomCronDeps {
  isPaused: () => Promise<boolean>;
  countAlertsToday: (now: Date) => Promise<number>;
  discoverYoutube: () => Promise<DiscoveryResult>;
  discoverTikTok: () => Promise<DiscoveryResult>;
  discoverInstagram: () => Promise<DiscoveryResult>;
  insertAlert: (params: { post: DiscoveredPost; severity: WarroomSeverity; now: Date }) => Promise<{ inserted: boolean }>;
  pauseForBudget: (reason: string) => Promise<void>;
  getOptedInEmails: () => Promise<string[]>;
  emailClient: EmailClient;
  operatorEmail: string;
  sleep: (ms: number) => Promise<void>;
}

export interface WarroomCronResult {
  skipped: 'paused' | 'daily_cap' | 'budget_exceeded' | null;
  inserted: number;
}

const SEVERITY_RANK: Record<WarroomSeverity, number> = { already_viral: 3, going_viral: 2, heating_up: 1 };

/**
 * One pass (currently scheduled daily, not hourly as originally designed —
 * see the comment above app/api/cron/warroom/route.ts's maxDuration for
 * why): gate on pause/daily-cap, discover in parallel across all three
 * platforms, score, cap to the top WARROOM_PER_RUN_CAP alerts,
 * insert (relying on the DB's unique constraint for cross-run dedup), and
 * fan out opt-in email for the top two severities. See design spec §4.
 */
export async function runWarroomCron(deps: WarroomCronDeps, now: Date): Promise<WarroomCronResult> {
  if (await deps.isPaused()) {
    return { skipped: 'paused', inserted: 0 };
  }

  const todayCount = await deps.countAlertsToday(now);
  if (todayCount >= WARROOM_DAILY_ALERT_CAP) {
    return { skipped: 'daily_cap', inserted: 0 };
  }

  const settled = await Promise.allSettled([deps.discoverYoutube(), deps.discoverTikTok(), deps.discoverInstagram()]);

  const allErrors: string[] = [];
  const allPosts: DiscoveredPost[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value.posts);
      allErrors.push(...result.value.errors);
    } else {
      allErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const budgetError = allErrors.find((e) => BUDGET_EXCEEDED_RE.test(e));
  if (budgetError) {
    await deps.pauseForBudget(budgetError);
    await deps.emailClient.sendEmail({
      to: deps.operatorEmail,
      subject: '🛑 GTA6 War Room Paused — Apify Budget Exhausted',
      html: `<p>The War Room cron paused itself after detecting an Apify budget error:</p><p>${escapeHtml(budgetError)}</p><p>Reactivate manually once usage resets (design spec §4) — this does not happen automatically.</p>`,
    });
    return { skipped: 'budget_exceeded', inserted: 0 };
  }

  for (const error of allErrors) {
    // Non-budget failures are logged, not paged — not worth an email over one bad scrape.
    console.error('War Room discovery error (non-budget):', error);
  }

  const seenInRun = new Set<string>();
  const candidates: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  for (const post of allPosts) {
    const key = `${post.platform}:${post.externalPostId}`;
    if (seenInRun.has(key)) continue;
    seenInRun.add(key);
    const severity = classifySeverity(post, now);
    if (severity) candidates.push({ post, severity });
  }

  candidates.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.post.viewCount - a.post.viewCount);
  // Clamp to whatever headroom remains under the daily cap, not just the
  // flat per-run cap — otherwise a run starting at e.g. todayCount=29 could
  // still insert up to WARROOM_PER_RUN_CAP more, exceeding the stated
  // 30/day limit. The earlier todayCount >= WARROOM_DAILY_ALERT_CAP guard
  // means remainingCapacity here is always >= 1.
  const remainingCapacity = WARROOM_DAILY_ALERT_CAP - todayCount;
  const capped = candidates.slice(0, Math.min(WARROOM_PER_RUN_CAP, remainingCapacity));

  let insertedCount = 0;
  const newlyInserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  for (const candidate of capped) {
    const { inserted } = await deps.insertAlert({ post: candidate.post, severity: candidate.severity, now });
    if (inserted) {
      insertedCount += 1;
      newlyInserted.push(candidate);
    }
  }

  const emailWorthy = newlyInserted.filter((c) => c.severity === 'going_viral' || c.severity === 'already_viral');
  if (emailWorthy.length > 0) {
    const recipients = await deps.getOptedInEmails();
    for (const to of recipients) {
      for (const { post, severity } of emailWorthy) {
        try {
          await deps.emailClient.sendEmail({
            to,
            subject: `${severity === 'already_viral' ? '💥 Already Viral' : '🚀 Going Viral'} on ${post.platform}`,
            html: `<p>${escapeHtml(post.captionOrTitle)}</p><p><a href="${safeUrl(post.url)}">View post</a></p>`,
          });
        } catch (err) {
          // One bad address or one rate-limited request must not abort the
          // whole fan-out and silently drop every remaining recipient's
          // email — the alerts are already inserted and permanently
          // deduped, so a thrown error here means this alert is never
          // emailed to anyone again.
          console.error('War Room email send failed (non-fatal):', to, err instanceof Error ? err.message : err);
        }
        // Stay under Resend's default rate limit (2 req/s) — this is a
        // simple fixed-delay throttle, not a sophisticated batching
        // scheme, which is fine given the small per-run cap.
        await deps.sleep(600);
      }
    }
  }

  return { skipped: null, inserted: insertedCount };
}
