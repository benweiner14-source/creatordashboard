import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateLocale } from '@/lib/settings/locale-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateLocale(
    {
      saveLocale: async (profileId, params) => {
        const update: { timezone?: string; locale?: string } = {};
        if (params.timezone !== undefined) update.timezone = params.timezone;
        if (params.locale !== undefined) update.locale = params.locale;
        const { error } = await serviceClient.from('profiles').update(update).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save locale: ${error.message}`);
        }
      },
    },
    {
      profileId: user?.id ?? null,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
