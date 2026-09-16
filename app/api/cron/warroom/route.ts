import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createResendEmailClient } from '@/lib/integrations/resend';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { searchGta6Videos } from '@/lib/warroom/discovery/youtube';
import { searchGta6TikToks } from '@/lib/warroom/discovery/tiktok';
import { searchGta6InstagramPosts } from '@/lib/warroom/discovery/instagram';
import { runWarroomCron } from '@/lib/warroom/cron-handler';
import type { DiscoveredPost, WarroomSeverity } from '@/lib/warroom/types';

// Discovery calls (especially the Apify ones) can each take up to ~90s;
// running all three in parallel keeps total wall-clock bounded by the
// slowest single call rather than their sum. Matches the old weekly-digest
// cron's maxDuration.
export const maxDuration = 300;

// vercel.json currently schedules this daily ("0 0 * * *"), not hourly as
// originally designed (design spec §4) -- Vercel Hobby plan only supports
// daily cron jobs; hourly needs Pro. Switch vercel.json's schedule back to
// "0 * * * *" once on Pro. Every discovery/scoring window here (YouTube's
// 24h lookback, TikTok/Instagram's LAST_24H, classifySeverity's 12h/24h/48h
// tiers) already assumes roughly a day's worth of content per run, so daily
// cadence doesn't break anything -- it just means War Room is no longer
// "real-time," closer to a daily digest, until this reverts to hourly.

function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.WARROOM_FROM_EMAIL) {
    console.error('WARROOM_FROM_EMAIL is not set — War Room emails will fail to send.');
  }
  if (!process.env.WARROOM_OPERATOR_EMAIL) {
    console.error('WARROOM_OPERATOR_EMAIL is not set — a budget-exhaustion pause will not notify anyone.');
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const emailClient = createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.WARROOM_FROM_EMAIL ?? '');
  const apifyToken = process.env.APIFY_API_TOKEN ?? '';
  const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? '';
  const now = new Date();

  const result = await runWarroomCron(
    {
      isPaused: async () => {
        const { data, error } = await serviceClient.from('warroom_settings').select('paused').eq('id', true).single();
        if (error) {
          // Fail loud, not open: this read is the cron's cost-control safety
          // valve. Silently treating a read error as "not paused" would let
          // the job keep calling paid Apify actors during exactly the
          // outage where the pause flag is least trustworthy.
          throw new Error(`Failed to read War Room pause state: ${error.message}`);
        }
        return data?.paused ?? false;
      },
      countAlertsToday: async (asOf) => {
        const startOfDay = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())).toISOString();
        const { count, error } = await serviceClient
          .from('warroom_alerts')
          .select('id', { count: 'exact', head: true })
          .gte('detected_at', startOfDay);
        if (error) {
          // Same fail-loud reasoning as isPaused/pauseForBudget above: a
          // silent 0 here would reset the daily-cap accounting and let the
          // run insert (and email) past the stated 30/day limit.
          throw new Error(`Failed to count today's War Room alerts: ${error.message}`);
        }
        return count ?? 0;
      },
      // 24h, not 1h: classifySeverity's YouTube tiers look at posts up to 48h
      // old, and a video is never re-examined in a later run once it falls
      // outside this window — a 1h window made most of those tiers
      // unreachable. The permanent unique(platform, external_post_id)
      // constraint already prevents re-alerting on a video seen before, so
      // widening this is safe. Still one 100-unit search.list call well
      // inside the 10,000/day quota (design spec §2).
      discoverYoutube: () => searchGta6Videos(youtubeApiKey, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      discoverTikTok: () => searchGta6TikToks(apifyToken),
      discoverInstagram: () => searchGta6InstagramPosts(apifyToken),
      insertAlert: async ({ post, severity, now: insertedAt }: { post: DiscoveredPost; severity: WarroomSeverity; now: Date }) => {
        const { data, error } = await serviceClient
          .from('warroom_alerts')
          .upsert(
            {
              platform: post.platform,
              external_post_id: post.externalPostId,
              url: post.url,
              caption_or_title: post.captionOrTitle,
              view_count: post.viewCount,
              engagement_count: post.engagementCount,
              published_at: post.publishedAt,
              severity,
              detected_at: insertedAt.toISOString(),
            },
            { onConflict: 'platform,external_post_id', ignoreDuplicates: true }
          )
          .select('id');
        if (error) {
          throw new Error(`Failed to insert War Room alert: ${error.message}`);
        }
        return { inserted: (data?.length ?? 0) > 0 };
      },
      pauseForBudget: async (reason) => {
        const { error } = await serviceClient
          .from('warroom_settings')
          .update({ paused: true, paused_reason: reason, paused_at: new Date().toISOString() })
          .eq('id', true);
        if (error) {
          // If this write silently fails, the pause never actually takes
          // effect: next run's isPaused() still reads false, the cron
          // calls the discovery clients again, hits the same budget error,
          // and re-sends the operator email — every run, forever. Throw so
          // the failure is visible instead of a quiet no-op.
          throw new Error(`Failed to persist War Room pause: ${error.message}`);
        }
      },
      getOptedInEmails: async () => {
        const { data: profiles, error } = await serviceClient.from('profiles').select('id').eq('warroom_email_opt_in', true);
        if (error) {
          throw new Error(`Failed to load War Room opt-in profiles: ${error.message}`);
        }
        // profiles.email is client-writable and untrustworthy as a mail target
        // (same reasoning as the old weekly-digest cron) — the verified address
        // lives in Supabase Auth, looked up per-candidate via the admin API.
        // Also re-check subscription status here, not just at opt-in time: a
        // profile that opted in while subscribed and later lets their
        // subscription lapse must stop receiving this paywalled feed by
        // email, the same way the in-app feed already 402s them.
        const emails: string[] = [];
        for (const profile of profiles ?? []) {
          if (!(await hasActiveSubscription(serviceClient, profile.id))) continue;
          const { data: userData } = await serviceClient.auth.admin.getUserById(profile.id);
          if (userData?.user?.email) emails.push(userData.user.email);
        }
        return emails;
      },
      emailClient,
      operatorEmail: process.env.WARROOM_OPERATOR_EMAIL ?? '',
      // Injected so tests can run the email fan-out's rate-limit throttle
      // instantly instead of waiting through real timers.
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    now
  );

  return NextResponse.json(result);
}
