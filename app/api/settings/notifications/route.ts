import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateNotifications } from '@/lib/settings/notifications-handler';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }
  const serviceClient = createSupabaseServiceRoleClient();
  const { data } = await serviceClient
    .from('notification_preferences')
    .select('weekly_recap_ready, new_content_ideas_ready, diagnostic_finished, product_marketing, payment_billing_alerts')
    .eq('profile_id', user.id)
    .single();

  return NextResponse.json({
    recap: data?.weekly_recap_ready ?? true,
    ideas: data?.new_content_ideas_ready ?? true,
    diagnostic: data?.diagnostic_finished ?? true,
    product: data?.product_marketing ?? false,
    billing: data?.payment_billing_alerts ?? true,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateNotifications(
    {
      savePreferences: async (profileId, columns) => {
        const { error } = await serviceClient
          .from('notification_preferences')
          .upsert({ profile_id: profileId, ...columns, updated_at: new Date().toISOString() });
        if (error) {
          throw new Error(`Failed to save notification preferences: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, updates: body }
  );

  return NextResponse.json(result.body, { status: result.status });
}
