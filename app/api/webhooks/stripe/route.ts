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
          const { data, error } = await serviceClient
            .from('subscriptions')
            .update({
              stripe_subscription_id: stripeSubscriptionId,
              status,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', stripeCustomerId)
            .select();
          if (error) {
            throw new Error(`Failed to sync subscription: ${error.message}`);
          }
          if (!data || data.length === 0) {
            // The row is created by /api/billing/checkout before Stripe ever
            // knows about the customer, so this should never happen in
            // normal operation — if it does (a customer created outside our
            // checkout flow, a deleted profile, manual data repair), fail
            // loudly rather than silently leaving the subscriber unentitled.
            throw new Error(`No subscription row found for Stripe customer ${stripeCustomerId}`);
          }
        },
        markSubscriptionCanceled: async (stripeCustomerId, stripeSubscriptionId) => {
          const { data, error } = await serviceClient
            .from('subscriptions')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('stripe_customer_id', stripeCustomerId)
            .eq('stripe_subscription_id', stripeSubscriptionId)
            .select();
          if (error) {
            throw new Error(`Failed to mark subscription canceled: ${error.message}`);
          }
          if (!data || data.length === 0) {
            // A stale/reordered deletion event for a subscription that's no
            // longer current (or never matched) — not an error worth
            // retrying Stripe over, since a newer subscription may already
            // be active for this customer and we must not touch it.
            console.warn(`No matching subscription row for customer ${stripeCustomerId} / subscription ${stripeSubscriptionId} on delete — skipping`);
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
