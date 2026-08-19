import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createClaudeContentIdeasClient } from '@/lib/integrations/claude-ideas';
import { createResendEmailClient } from '@/lib/integrations/resend';
import { runWeeklyDigestCron } from '@/lib/digest/cron-handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import type { DigestRow } from '@/lib/digest/cron-handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

// Vercel's platform default execution limit is far shorter than a batch of
// per-candidate Claude generations can need; request the maximum this route
// segment is allowed rather than falling back to that default.
export const maxDuration = 300;

function mapDigestRow(row: {
  id: string;
  profile_id: string;
  week_start: string;
  content_ideas: unknown;
  sent_at: string | null;
}): DigestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    weekStart: row.week_start,
    contentIdeas: row.content_ideas as ContentIdea[],
    sentAt: row.sent_at,
  };
}

// Verifies the request actually came from the scheduler, not an arbitrary
// caller. NOTE for implementers: this repo's own AGENTS.md warns training
// data about this stack may be stale — verify Vercel's current documented
// cron-authentication mechanism before relying on this exact header shape;
// the fixed requirement is "reject anything that doesn't prove it came from
// the scheduled trigger," not this literal implementation.
function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const appUrl = new URL(request.url).origin;

  const result = await runWeeklyDigestCron(
    {
      getOptedInCandidates: async (limit) => {
        const { data, error } = await serviceClient
          .from('profiles')
          .select('id, niche')
          .eq('digest_email_opt_in', true)
          .not('niche', 'is', null)
          .order('digest_last_sent_at', { ascending: true, nullsFirst: true })
          .limit(limit);
        if (error) {
          throw new Error(`Failed to fetch opted-in candidates: ${error.message}`);
        }

        // profiles.email is client-writable (no `with check` on the RLS
        // update policy) and must never be trusted as a mail target — a
        // signed-in user could rewrite it to redirect someone else's digest
        // to an address they don't control. The verified address lives in
        // Supabase Auth, so look it up per-candidate via the admin API and
        // skip anyone whose lookup fails rather than failing the whole run.
        const candidates: { profileId: string; email: string; niche: string }[] = [];
        for (const row of data ?? []) {
          // Weekly email delivery is a paid feature. Checking entitlement
          // here (rather than only at opt-in time) means the cron
          // self-corrects the moment a subscription lapses — no separate
          // cleanup job needs to flip digest_email_opt_in back off.
          if (!(await hasActiveSubscription(serviceClient, row.id))) {
            continue;
          }
          const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(row.id);
          if (userError || !userData?.user?.email) {
            continue;
          }
          candidates.push({ profileId: row.id, email: userData.user.email, niche: row.niche as string });
        }
        return candidates;
      },
      getExistingDigest: async (profileId, weekStart) => {
        const { data } = await serviceClient
          .from('weekly_digests')
          .select('*')
          .eq('profile_id', profileId)
          .eq('week_start', weekStart)
          .maybeSingle();
        return data ? mapDigestRow(data) : null;
      },
      saveDigest: async ({ profileId, weekStart, contentIdeas }) => {
        const { data, error } = await serviceClient
          .from('weekly_digests')
          .insert({ profile_id: profileId, week_start: weekStart, content_ideas: contentIdeas })
          .select('*')
          .single();
        if (error || !data) {
          throw new Error(`Failed to save weekly digest: ${error?.message}`);
        }
        return mapDigestRow(data);
      },
      markDigestSent: async (digestId, sentAt) => {
        const { error } = await serviceClient
          .from('weekly_digests')
          .update({ sent_at: sentAt.toISOString() })
          .eq('id', digestId);
        if (error) {
          throw new Error(`Failed to mark digest sent: ${error.message}`);
        }
      },
      markProfileDigestSent: async (profileId, sentAt) => {
        const { error } = await serviceClient
          .from('profiles')
          .update({ digest_last_sent_at: sentAt.toISOString() })
          .eq('id', profileId);
        if (error) {
          throw new Error(`Failed to mark profile digest sent: ${error.message}`);
        }
      },
      contentIdeasClient: createClaudeContentIdeasClient(process.env.ANTHROPIC_API_KEY ?? ''),
      emailClient: createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.DIGEST_FROM_EMAIL ?? ''),
      unsubscribeSecret: process.env.DIGEST_UNSUBSCRIBE_SECRET ?? '',
      appUrl,
    },
    new Date()
  );

  return NextResponse.json(result);
}
