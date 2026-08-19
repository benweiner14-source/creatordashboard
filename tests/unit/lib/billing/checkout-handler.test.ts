import { describe, it, expect, vi } from 'vitest';
import { handleCheckoutRequest } from '@/lib/billing/checkout-handler';
import { createFakeStripeClient } from '../../../fakes/stripe.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleCheckoutRequest>[0]> = {}) {
  return {
    stripeClient: createFakeStripeClient(),
    priceId: 'price_test',
    successUrl: 'https://example.com/billing?checkout=success',
    cancelUrl: 'https://example.com/billing',
    getSubscriptionCustomerId: async () => null,
    createSubscriptionRow: async () => {},
    getProfileEmail: async () => 'creator@example.com',
    ...overrides,
  };
}

describe('handleCheckoutRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleCheckoutRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('creates a new Stripe customer and subscription row on first checkout', async () => {
    const createSubscriptionRow = vi.fn();
    const stripeClient = createFakeStripeClient({ createCustomer: async () => ({ id: 'cus_new' }) });
    const deps = makeDeps({ createSubscriptionRow, stripeClient });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(createSubscriptionRow).toHaveBeenCalledWith({ profileId: 'profile-1', stripeCustomerId: 'cus_new' });
    expect(result.status).toBe(200);
    expect(result.body.url).toBeTruthy();
  });

  it('reuses an existing Stripe customer instead of creating a duplicate', async () => {
    const createCustomer = vi.fn();
    const createSubscriptionRow = vi.fn();
    const deps = makeDeps({
      getSubscriptionCustomerId: async () => 'cus_existing',
      stripeClient: createFakeStripeClient({ createCustomer }),
      createSubscriptionRow,
    });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSubscriptionRow).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it('returns the checkout session URL', async () => {
    const stripeClient = createFakeStripeClient({
      createCheckoutSession: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' }),
    });
    const deps = makeDeps({ getSubscriptionCustomerId: async () => 'cus_existing', stripeClient });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(result.body).toEqual({ url: 'https://checkout.stripe.com/pay/cs_1' });
  });
});
