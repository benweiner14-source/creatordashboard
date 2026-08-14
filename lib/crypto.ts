import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function loadKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be a 32-byte (64 hex character) key.');
  }
  return key;
}

/**
 * Encrypts a plaintext token for storage. Packs iv + authTag + ciphertext
 * into one base64 string so a single text column can hold it. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §1.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  const key = loadKey(hexKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptToken(encoded: string, hexKey: string): string {
  const key = loadKey(hexKey);
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, IV_LENGTH_BYTES);
  const authTag = packed.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = packed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
