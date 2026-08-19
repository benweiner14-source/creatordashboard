import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hand-rolled verification of Stripe's webhook signature scheme, matching
 * this codebase's existing precedent for hand-rolled signed tokens
 * (lib/digest/unsubscribe-token.ts, lib/oauth/state.ts) rather than
 * pulling in the Stripe SDK for one cryptographic check. Scheme:
 * header is `t=<unix-seconds>,v1=<hex-hmac-sha256("t.payload")>`.
 */

const TOLERANCE_SECONDS = 300; // Stripe's own default replay-attack tolerance

export interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
  now: Date = new Date()
): StripeWebhookEvent {
  if (!signatureHeader) {
    throw new Error('Missing Stripe-Signature header');
  }

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error('Malformed Stripe-Signature header');
  }

  const expectedSignature = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Stripe webhook signature verification failed');
  }

  const ageSeconds = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (ageSeconds > TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook timestamp too old');
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}
