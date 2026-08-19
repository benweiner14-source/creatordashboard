import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe-webhook';
import { handleStripeWebhookEvent } from '@/lib/billing/webhook-handler';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  try {
    await handleStripeWebhookEvent(
      {
        // The row being updated here always already exists — it's created
        // by POST /api/billing/checkout the moment a creator starts
        // checkout, before Stripe ever knows about the customer. A plain
        // update (keyed by the unique stripe_customer_id) is always
        // correct and simpler than an upsert. See spec §1/§5.
        updateSubscriptionFromStripe: async ({ stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd }) => {
          const { error } = await serviceClient
            .from('subscriptions')
            .update({
              stripe_subscription_id: stripeSubscriptionId,
              status,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd,
            })
            .eq('stripe_customer_id', stripeCustomerId);
          if (error) {
            throw new Error(`Failed to sync subscription: ${error.message}`);
          }
        },
        markSubscriptionCanceled: async (stripeCustomerId) => {
          const { error } = await serviceClient.from('subscriptions').update({ status: 'canceled' }).eq('stripe_customer_id', stripeCustomerId);
          if (error) {
            throw new Error(`Failed to mark subscription canceled: ${error.message}`);
          }
        },
      },
      event
    );
  } catch (err) {
    console.error('Stripe webhook handling failed:', err);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
