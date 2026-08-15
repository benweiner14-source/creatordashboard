import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A stateless, verifiable link token for one-click email unsubscribe — no
 * database lookup needed to check it. HMAC-SHA256 of the profile ID, keyed
 * by DIGEST_UNSUBSCRIBE_SECRET. See
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function generateUnsubscribeToken(profileId: string, secret: string): string {
  if (!secret) {
    throw new Error('DIGEST_UNSUBSCRIBE_SECRET must be set.');
  }
  return createHmac('sha256', secret).update(profileId).digest('hex');
}

export function verifyUnsubscribeToken(profileId: string, token: string, secret: string): boolean {
  if (!secret) {
    throw new Error('DIGEST_UNSUBSCRIBE_SECRET must be set.');
  }
  const expected = generateUnsubscribeToken(profileId, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(token, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
