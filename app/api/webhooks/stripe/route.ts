import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe-webhook';
import { handleStripeWebhookEvent } from '@/lib/billing/webhook-handler';
import { shouldSendPastDueAlert } from '@/lib/billing/payment-alerts';
import { createResendEmailClient } from '@/lib/integrations/resend';

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
  const emailClient = createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.DIGEST_FROM_EMAIL ?? '');

  async function sendPastDueAlertIfOptedIn(stripeCustomerId: string): Promise<void> {
    const { data: sub } = await serviceClient
      .from('subscriptions')
      .select('profile_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();
    if (!sub) return;

    const { data: prefs } = await serviceClient
      .from('notification_preferences')
      .select('payment_billing_alerts')
      .eq('profile_id', sub.profile_id)
      .maybeSingle();
    if (prefs?.payment_billing_alerts === false) return;

    // profiles.email is client-writable and not authoritative — the verified
    // address lives in Supabase Auth. Same hazard/fix as the weekly-digest
    // and checkout routes.
    const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(sub.profile_id);
    if (userError || !userData?.user?.email) return;

    await emailClient.sendEmail({
      to: userData.user.email,
      subject: "We couldn't process your last payment",
      html: '<p>We were unable to process your last payment for Creator Dashboard. Please update your card in Billing to keep your subscription active.</p>',
    });
  }

  try {
    await handleStripeWebhookEvent(
      {
        // The row being updated here always already exists — it's created
        // by POST /api/billing/checkout the moment a creator starts
        // checkout, before Stripe ever knows about the customer. A plain
        // update (keyed by the unique stripe_customer_id) is always
        // correct and simpler than an upsert. See spec §1/§5.
        updateSubscriptionFromStripe: async ({ stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd }) => {
          const { data: existing } = await serviceClient
            .from('subscriptions')
            .select('status')
            .eq('stripe_customer_id', stripeCustomerId)
            .maybeSingle();

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

          if (shouldSendPastDueAlert(existing?.status ?? null, status)) {
            await sendPastDueAlertIfOptedIn(stripeCustomerId);
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
