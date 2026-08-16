import { describe, it, expect } from 'vitest';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/digest/unsubscribe-token';

describe('unsubscribe token', () => {
  const secret = 'test-secret';

  it('round-trips: a generated token verifies for the same profile and secret', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    expect(verifyUnsubscribeToken('profile-1', token, secret)).toBe(true);
  });

  it('rejects a tampered token', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    const tampered = token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0');
    expect(verifyUnsubscribeToken('profile-1', tampered, secret)).toBe(false);
  });

  it('rejects a token generated with a different secret', () => {
    const token = generateUnsubscribeToken('profile-1', 'other-secret');
    expect(verifyUnsubscribeToken('profile-1', token, secret)).toBe(false);
  });

  it('rejects a token that is valid for a different profile', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    expect(verifyUnsubscribeToken('profile-2', token, secret)).toBe(false);
  });

  it('rejects a malformed (non-hex) token without throwing', () => {
    expect(() => verifyUnsubscribeToken('profile-1', 'not-valid-hex!!', secret)).not.toThrow();
    expect(verifyUnsubscribeToken('profile-1', 'not-valid-hex!!', secret)).toBe(false);
  });

  it('throws when generating a token with an empty secret', () => {
    expect(() => generateUnsubscribeToken('profile-1', '')).toThrow();
  });

  it('throws when verifying a token with an empty secret', () => {
    expect(() => verifyUnsubscribeToken('profile-1', 'sometoken', '')).toThrow();
  });
});
