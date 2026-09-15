import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createResendEmailClient } from '@/lib/integrations/resend';
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
  const emailClient = createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.WARROOM_FROM_EMAIL ?? '');
  const apifyToken = process.env.APIFY_API_TOKEN ?? '';
  const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? '';
  const now = new Date();

  const result = await runWarroomCron(
    {
      isPaused: async () => {
        const { data } = await serviceClient.from('warroom_settings').select('paused').eq('id', true).single();
        return data?.paused ?? false;
      },
      countAlertsToday: async (asOf) => {
        const startOfDay = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())).toISOString();
        const { count } = await serviceClient
          .from('warroom_alerts')
          .select('id', { count: 'exact', head: true })
          .gte('detected_at', startOfDay);
        return count ?? 0;
      },
      discoverYoutube: () => searchGta6Videos(youtubeApiKey, new Date(now.getTime() - 60 * 60 * 1000)),
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
        await serviceClient
          .from('warroom_settings')
          .update({ paused: true, paused_reason: reason, paused_at: new Date().toISOString() })
          .eq('id', true);
      },
      getOptedInEmails: async () => {
        const { data: profiles } = await serviceClient.from('profiles').select('id').eq('warroom_email_opt_in', true);
        // profiles.email is client-writable and untrustworthy as a mail target
        // (same reasoning as the old weekly-digest cron) — the verified address
        // lives in Supabase Auth, looked up per-candidate via the admin API.
        const emails: string[] = [];
        for (const profile of profiles ?? []) {
          const { data: userData } = await serviceClient.auth.admin.getUserById(profile.id);
          if (userData?.user?.email) emails.push(userData.user.email);
        }
        return emails;
      },
      emailClient,
      operatorEmail: process.env.WARROOM_OPERATOR_EMAIL ?? '',
    },
    now
  );

  return NextResponse.json(result);
}
