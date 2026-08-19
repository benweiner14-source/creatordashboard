import { describe, it, expect, vi } from 'vitest';
import { handleStripeWebhookEvent, mapStripeSubscriptionStatus } from '@/lib/billing/webhook-handler';

describe('mapStripeSubscriptionStatus', () => {
  it('passes through known statuses unchanged', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active');
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapStripeSubscriptionStatus('canceled')).toBe('canceled');
  });

  it('maps an unrecognized status to incomplete', () => {
    expect(mapStripeSubscriptionStatus('trialing')).toBe('incomplete');
    expect(mapStripeSubscriptionStatus('paused')).toBe('incomplete');
  });
});

describe('handleStripeWebhookEvent', () => {
  it('syncs subscription fields on customer.subscription.created', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() },
      {
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1786000000, cancel_at_period_end: false } },
      }
    );
    expect(updateSubscriptionFromStripe).toHaveBeenCalledWith({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'active',
      currentPeriodEnd: new Date(1786000000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it('syncs subscription fields on customer.subscription.updated, mapping an unknown status to incomplete', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing', current_period_end: null, cancel_at_period_end: true } },
      }
    );
    expect(updateSubscriptionFromStripe).toHaveBeenCalledWith({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'incomplete',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
    });
  });

  it('marks the subscription canceled on customer.subscription.deleted', async () => {
    const markSubscriptionCanceled = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe: vi.fn(), markSubscriptionCanceled },
      {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: null, cancel_at_period_end: false } },
      }
    );
    expect(markSubscriptionCanceled).toHaveBeenCalledWith('cus_1', 'sub_1');
  });

  it('is a no-op for an unrecognized event type', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    const markSubscriptionCanceled = vi.fn();
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled }, { type: 'invoice.paid', data: { object: {} } });
    expect(updateSubscriptionFromStripe).not.toHaveBeenCalled();
    expect(markSubscriptionCanceled).not.toHaveBeenCalled();
  });

  it('processing the same event twice produces identical writes both times (idempotency)', async () => {
    const calls: unknown[] = [];
    const updateSubscriptionFromStripe = vi.fn(async (params) => {
      calls.push(params);
    });
    const event = {
      type: 'customer.subscription.updated' as const,
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1786000000, cancel_at_period_end: false } },
    };
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() }, event);
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() }, event);
    expect(calls[0]).toEqual(calls[1]);
  });
});
