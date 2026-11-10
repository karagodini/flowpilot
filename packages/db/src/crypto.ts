import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptionKey(secret: string): Buffer {
  const hex = secret.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptJson(
  value: unknown,
  secret: string,
): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptJson<T = unknown>(
  payload: { ciphertext: string; iv: string; authTag: string },
  secret: string,
): T {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
