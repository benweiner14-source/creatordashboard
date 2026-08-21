import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handleCheckoutRequest } from '@/lib/billing/checkout-handler';

export async function POST(request: Request) {
  try {
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
        // profiles.email is client-writable (no `with check` on its RLS update
        // policy) and must never be trusted as a Stripe billing address — the
        // verified address lives in Supabase Auth. Same hazard/fix as
        // app/api/cron/weekly-digest/route.ts's getOptedInCandidates.
        getProfileEmail: async (profileId) => {
          const { data, error } = await serviceClient.auth.admin.getUserById(profileId);
          if (error || !data?.user?.email) return '';
          return data.user.email;
        },
      },
      { profileId: user?.id ?? null }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Checkout session creation failed:', err);
    return NextResponse.json({ error: 'Something went wrong starting checkout. Please try again.' }, { status: 500 });
  }
}
