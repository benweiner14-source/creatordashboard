import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe-webhook';

const SECRET = 'whsec_test_secret';

function signPayload(payload: string, timestamp: number, secret: string): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('verifyStripeWebhookSignature', () => {
  it('returns the parsed event for a validly signed payload', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(payload, timestamp, SECRET);

    const event = verifyStripeWebhookSignature(payload, header, SECRET, now);
    expect(event.type).toBe('customer.subscription.updated');
  });

  it('throws when the signature does not match the payload', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(payload, timestamp, 'a-different-secret');

    expect(() => verifyStripeWebhookSignature(payload, header, SECRET, now)).toThrow();
  });

  it('throws when the payload was tampered with after signing', () => {
    const originalPayload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(originalPayload, timestamp, SECRET);
    const tamperedPayload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_evil' } } });

    expect(() => verifyStripeWebhookSignature(tamperedPayload, header, SECRET, now)).toThrow();
  });

  it('throws when the signature header is missing', () => {
    expect(() => verifyStripeWebhookSignature('{}', null, SECRET)).toThrow('Missing Stripe-Signature header');
  });

  it('throws when the timestamp is outside the tolerance window', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const now = new Date('2026-08-19T12:00:00Z');
    const oldTimestamp = Math.floor(now.getTime() / 1000) - 600; // 10 minutes old
    const header = signPayload(payload, oldTimestamp, SECRET);

    expect(() => verifyStripeWebhookSignature(payload, header, SECRET, now)).toThrow('too old');
  });
});
