import type { StripeClient } from '@/lib/integrations/stripe';

export function createFakeStripeClient(overrides: Partial<StripeClient> = {}): StripeClient {
  return {
    createCustomer: async ({ email }) => ({ id: `cus_fake_${email}` }),
    createCheckoutSession: async () => ({ id: 'cs_fake_1', url: 'https://checkout.stripe.com/fake-session' }),
    createPortalSession: async () => ({ url: 'https://billing.stripe.com/fake-portal' }),
    ...overrides,
  };
}
