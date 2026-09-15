import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { handleListWarroomAlerts } from '@/lib/warroom/handler';
import type { WarroomAlertRow } from '@/lib/warroom/types';

function mapAlertRow(row: {
  id: string;
  platform: string;
  external_post_id: string;
  url: string;
  caption_or_title: string;
  view_count: number;
  engagement_count: number;
  published_at: string;
  severity: string;
  detected_at: string;
}): WarroomAlertRow {
  return {
    id: row.id,
    platform: row.platform as WarroomAlertRow['platform'],
    externalPostId: row.external_post_id,
    url: row.url,
    captionOrTitle: row.caption_or_title,
    viewCount: row.view_count,
    engagementCount: row.engagement_count,
    publishedAt: row.published_at,
    severity: row.severity as WarroomAlertRow['severity'],
    detectedAt: row.detected_at,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleListWarroomAlerts(
    {
      hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
      getRecentAlerts: async () => {
        const { data, error } = await serviceClient
          .from('warroom_alerts')
          .select('*')
          .order('detected_at', { ascending: false })
          .limit(100);
        if (error) {
          // A query failure must surface as a 500, not silently render as an
          // empty feed (200 with no alerts looks identical to "nothing has
          // happened yet" from the client's point of view).
          throw new Error(`Failed to load War Room alerts: ${error.message}`);
        }
        return (data ?? []).map(mapAlertRow);
      },
      setEmailOptIn: async () => {}, // unused on this route
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
