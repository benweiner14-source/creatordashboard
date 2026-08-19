import type { StripeClient } from '@/lib/integrations/stripe';

export interface PortalHandlerDeps {
  stripeClient: StripeClient;
  returnUrl: string;
  getSubscriptionCustomerId: (profileId: string) => Promise<string | null>;
}

export interface PortalRequestContext {
  profileId: string | null;
}

export interface PortalHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handlePortalRequest(deps: PortalHandlerDeps, context: PortalRequestContext): Promise<PortalHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to manage your plan.' } };
  }

  const customerId = await deps.getSubscriptionCustomerId(context.profileId);
  if (!customerId) {
    return { status: 400, body: { error: "You don't have a subscription to manage yet." } };
  }

  const session = await deps.stripeClient.createPortalSession({ customerId, returnUrl: deps.returnUrl });
  return { status: 200, body: { url: session.url } };
}
