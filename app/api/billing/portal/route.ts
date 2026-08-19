import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handlePortalRequest } from '@/lib/billing/portal-handler';

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();
    const origin = new URL(request.url).origin;

    const result = await handlePortalRequest(
      {
        stripeClient: createStripeClient(process.env.STRIPE_SECRET_KEY ?? ''),
        returnUrl: `${origin}/billing`,
        getSubscriptionCustomerId: async (profileId) => {
          const { data } = await serviceClient.from('subscriptions').select('stripe_customer_id').eq('profile_id', profileId).maybeSingle();
          return data?.stripe_customer_id ?? null;
        },
      },
      { profileId: user?.id ?? null }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Billing portal session creation failed:', err);
    return NextResponse.json({ error: 'Something went wrong opening your plan settings. Please try again.' }, { status: 500 });
  }
}
