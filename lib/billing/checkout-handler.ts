import type { StripeClient } from '@/lib/integrations/stripe';

export interface CheckoutHandlerDeps {
  stripeClient: StripeClient;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  getSubscriptionCustomerId: (profileId: string) => Promise<string | null>;
  createSubscriptionRow: (params: { profileId: string; stripeCustomerId: string }) => Promise<void>;
  getProfileEmail: (profileId: string) => Promise<string>;
}

export interface CheckoutRequestContext {
  profileId: string | null;
}

export interface CheckoutHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleCheckoutRequest(deps: CheckoutHandlerDeps, context: CheckoutRequestContext): Promise<CheckoutHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to upgrade.' } };
  }

  let customerId = await deps.getSubscriptionCustomerId(context.profileId);
  if (!customerId) {
    const email = await deps.getProfileEmail(context.profileId);
    const customer = await deps.stripeClient.createCustomer({ email });
    await deps.createSubscriptionRow({ profileId: context.profileId, stripeCustomerId: customer.id });
    customerId = customer.id;
  }

  const session = await deps.stripeClient.createCheckoutSession({
    customerId,
    priceId: deps.priceId,
    successUrl: deps.successUrl,
    cancelUrl: deps.cancelUrl,
  });

  return { status: 200, body: { url: session.url } };
}
