import type { StripeWebhookEvent } from './stripe-webhook';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

const KNOWN_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due', 'canceled', 'incomplete'];

/**
 * Narrows Stripe's full status vocabulary ('trialing', 'unpaid', 'paused',
 * etc.) down to the four this app branches on — see spec §1. This plan has
 * no trial/pause support, so anything outside that set maps to
 * 'incomplete', which reads as "no access" everywhere entitlement is checked.
 */
export function mapStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(stripeStatus) ? (stripeStatus as SubscriptionStatus) : 'incomplete';
}

export interface StripeSubscriptionEventObject {
  id: string;
  customer: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

export interface WebhookHandlerDeps {
  updateSubscriptionFromStripe: (params: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }) => Promise<void>;
  markSubscriptionCanceled: (stripeCustomerId: string, stripeSubscriptionId: string) => Promise<void>;
}

export async function handleStripeWebhookEvent(deps: WebhookHandlerDeps, event: StripeWebhookEvent): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as unknown as StripeSubscriptionEventObject;
      await deps.updateSubscriptionFromStripe({
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        status: mapStripeSubscriptionStatus(sub.status),
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as unknown as StripeSubscriptionEventObject;
      await deps.markSubscriptionCanceled(sub.customer, sub.id);
      return;
    }
    default:
      // Unrecognized event type — intentional no-op. The route still
      // returns 200 so Stripe doesn't retry something we deliberately
      // ignore. See spec §5.
      return;
  }
}
