import { describe, it, expect } from 'vitest';
import { handlePortalRequest } from '@/lib/billing/portal-handler';
import { createFakeStripeClient } from '../../../fakes/stripe.fake';

function makeDeps(overrides: Partial<Parameters<typeof handlePortalRequest>[0]> = {}) {
  return {
    stripeClient: createFakeStripeClient(),
    returnUrl: 'https://example.com/billing',
    getSubscriptionCustomerId: async () => 'cus_existing',
    ...overrides,
  };
}

describe('handlePortalRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handlePortalRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('rejects a profile with no Stripe customer yet', async () => {
    const deps = makeDeps({ getSubscriptionCustomerId: async () => null });
    const result = await handlePortalRequest(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(400);
  });

  it('returns the portal session URL for an existing customer', async () => {
    const stripeClient = createFakeStripeClient({ createPortalSession: async () => ({ url: 'https://billing.stripe.com/session/xyz' }) });
    const deps = makeDeps({ stripeClient });
    const result = await handlePortalRequest(deps, { profileId: 'profile-1' });
    expect(result.body).toEqual({ url: 'https://billing.stripe.com/session/xyz' });
  });
});
