import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStripeClient } from '@/lib/integrations/stripe';

describe('createStripeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a customer via the Stripe API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cus_123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createStripeClient('sk_test_123');
    const customer = await client.createCustomer({ email: 'creator@example.com' });

    expect(customer).toEqual({ id: 'cus_123' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/customers');
    expect(options.headers.Authorization).toBe('Bearer sk_test_123');
    expect(options.body).toContain('email=creator%40example.com');
  });

  it('creates a checkout session via the Stripe API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createStripeClient('sk_test_123');
    const session = await client.createCheckoutSession({
      customerId: 'cus_123',
      priceId: 'price_123',
      successUrl: 'https://example.com/billing?checkout=success',
      cancelUrl: 'https://example.com/billing',
    });

    expect(session).toEqual({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(options.body).toContain('customer=cus_123');
    expect(options.body).toContain('line_items%5B0%5D%5Bprice%5D=price_123');
    expect(options.body).toContain('mode=subscription');
  });

  it('creates a billing portal session via the Stripe API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://billing.stripe.com/session/xyz' }) }));

    const client = createStripeClient('sk_test_123');
    const session = await client.createPortalSession({ customerId: 'cus_123', returnUrl: 'https://example.com/billing' });

    expect(session).toEqual({ url: 'https://billing.stripe.com/session/xyz' });
  });

  it('throws with the Stripe-provided message when the API returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: { message: 'Your card was declined.' } }) })
    );
    const client = createStripeClient('sk_test_123');
    await expect(client.createCustomer({ email: 'creator@example.com' })).rejects.toThrow('Your card was declined.');
  });
});
