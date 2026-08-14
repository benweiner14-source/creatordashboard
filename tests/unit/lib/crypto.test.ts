import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/crypto';

const TEST_KEY = '0'.repeat(64); // 32 bytes of zero, a validly-shaped hex key for tests

describe('encryptToken / decryptToken', () => {
  it('round-trips a plaintext value', () => {
    const ciphertext = encryptToken('my-secret-access-token', TEST_KEY);
    expect(decryptToken(ciphertext, TEST_KEY)).toBe('my-secret-access-token');
  });

  it('produces ciphertext that does not contain the plaintext', () => {
    const ciphertext = encryptToken('my-secret-access-token', TEST_KEY);
    expect(ciphertext).not.toContain('my-secret-access-token');
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const a = encryptToken('same-value', TEST_KEY);
    const b = encryptToken('same-value', TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('throws when the key is not a 32-byte hex string', () => {
    expect(() => encryptToken('value', 'too-short')).toThrow('32-byte');
  });

  it('throws when decrypting with the wrong key', () => {
    const ciphertext = encryptToken('value', TEST_KEY);
    const wrongKey = '1'.repeat(64);
    expect(() => decryptToken(ciphertext, wrongKey)).toThrow();
  });
});
