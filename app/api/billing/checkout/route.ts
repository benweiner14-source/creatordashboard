import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handleCheckoutRequest } from '@/lib/billing/checkout-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const origin = new URL(request.url).origin;

  const result = await handleCheckoutRequest(
    {
      stripeClient: createStripeClient(process.env.STRIPE_SECRET_KEY ?? ''),
      priceId: process.env.STRIPE_PRICE_ID ?? '',
      successUrl: `${origin}/billing?checkout=success`,
      cancelUrl: `${origin}/billing`,
      getSubscriptionCustomerId: async (profileId) => {
        const { data } = await serviceClient.from('subscriptions').select('stripe_customer_id').eq('profile_id', profileId).maybeSingle();
        return data?.stripe_customer_id ?? null;
      },
      createSubscriptionRow: async ({ profileId, stripeCustomerId }) => {
        const { error } = await serviceClient
          .from('subscriptions')
          .insert({ profile_id: profileId, stripe_customer_id: stripeCustomerId, status: 'incomplete' });
        if (error) {
          throw new Error(`Failed to create subscription row: ${error.message}`);
        }
      },
      getProfileEmail: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('email').eq('id', profileId).single();
        return data?.email ?? '';
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
