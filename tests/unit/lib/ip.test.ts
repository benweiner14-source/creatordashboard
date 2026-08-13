import { describe, it, expect } from 'vitest';
import { deriveClientIp } from '@/lib/ip';

function headersFrom(value: string | null) {
  return { get: (name: string) => (name === 'x-forwarded-for' ? value : null) };
}

describe('deriveClientIp', () => {
  it('trusts the first entry of x-forwarded-for on a trusted platform (Vercel)', () => {
    const ip = deriveClientIp({
      headers: headersFrom('203.0.113.7, 70.41.3.18, 150.172.238.178'),
      isTrustedPlatform: true,
    });
    expect(ip).toBe('203.0.113.7');
  });

  it('falls back to 0.0.0.0 on a trusted platform when the header is missing', () => {
    const ip = deriveClientIp({ headers: headersFrom(null), isTrustedPlatform: true });
    expect(ip).toBe('0.0.0.0');
  });

  it('does not trust x-forwarded-for on an untrusted platform with no configured proxy hops', () => {
    const ip = deriveClientIp({
      headers: headersFrom('203.0.113.7'),
      isTrustedPlatform: false,
    });
    expect(ip).toBe('0.0.0.0');
  });

  it('does not trust x-forwarded-for on an untrusted platform when trustedProxyHops is explicitly 0', () => {
    const ip = deriveClientIp({
      headers: headersFrom('203.0.113.7'),
      isTrustedPlatform: false,
      trustedProxyHops: 0,
    });
    expect(ip).toBe('0.0.0.0');
  });

  it('trusts the Nth-from-the-right entry when trustedProxyHops is explicitly configured', () => {
    // A client could prepend anything to the left of the chain; only the
    // rightmost `trustedProxyHops` entries were actually appended by our
    // own trusted reverse proxy(s).
    const ip = deriveClientIp({
      headers: headersFrom('attacker-supplied, 203.0.113.7'),
      isTrustedPlatform: false,
      trustedProxyHops: 1,
    });
    expect(ip).toBe('203.0.113.7');
  });

  it('falls back to 0.0.0.0 when trustedProxyHops exceeds the number of entries in the chain', () => {
    const ip = deriveClientIp({
      headers: headersFrom('203.0.113.7'),
      isTrustedPlatform: false,
      trustedProxyHops: 2,
    });
    expect(ip).toBe('0.0.0.0');
  });

  it('falls back to 0.0.0.0 when the header is missing, regardless of trustedProxyHops', () => {
    const ip = deriveClientIp({ headers: headersFrom(null), isTrustedPlatform: false, trustedProxyHops: 1 });
    expect(ip).toBe('0.0.0.0');
  });

  it('trims whitespace around each entry in the chain', () => {
    const ip = deriveClientIp({
      headers: headersFrom('  203.0.113.7  ,  70.41.3.18  '),
      isTrustedPlatform: true,
    });
    expect(ip).toBe('203.0.113.7');
  });
});
