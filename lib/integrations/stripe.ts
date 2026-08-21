/**
 * Plain fetch against Stripe's REST API — no SDK dependency, matching
 * every other external integration in this codebase (see
 * lib/integrations/resend.ts). See docs/superpowers/specs/2026-08-19-paid-tier-billing-design.md §2.
 */

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export interface StripePortalSession {
  url: string;
}

export interface StripeClient {
  createCustomer(params: { email: string }): Promise<StripeCustomer>;
  createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckoutSession>;
  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<StripePortalSession>;
}

export function createStripeClient(secretKey: string): StripeClient {
  async function stripeRequest(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = (data as { error?: { message?: string } }).error?.message ?? `Stripe API request failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  return {
    async createCustomer({ email }) {
      const data = await stripeRequest('customers', { email });
      return { id: data.id as string };
    },
    async createCheckoutSession({ customerId, priceId, successUrl, cancelUrl }) {
      const data = await stripeRequest('checkout/sessions', {
        customer: customerId,
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      return { id: data.id as string, url: data.url as string };
    },
    async createPortalSession({ customerId, returnUrl }) {
      const data = await stripeRequest('billing_portal/sessions', {
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: data.url as string };
    },
  };
}
