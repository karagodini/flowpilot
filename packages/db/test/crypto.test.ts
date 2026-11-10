import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, encryptionKey } from '../src/crypto.js';

const KEY = 'ab'.repeat(32);

describe('credential encryption', () => {
  it('round-trips a vault payload', () => {
    const payload = { botToken: '123456:local-only', chat: 'ops' };
    const sealed = encryptJson(payload, KEY);
    expect(sealed.ciphertext).not.toContain('local-only');
    expect(decryptJson<typeof payload>(sealed, KEY)).toEqual(payload);
  });

  it('rejects a key that is not 32 bytes of hex', () => {
    expect(() => encryptionKey('short')).toThrow(/64 hex/);
  });

  it('fails closed when the auth tag is altered', () => {
    const sealed = encryptJson({ apiKey: 'sk-local' }, KEY);
    const tampered = { ...sealed, authTag: Buffer.from('nope-nope-nope').toString('base64') };
    expect(() => decryptJson(tampered, KEY)).toThrow();
  });
});
