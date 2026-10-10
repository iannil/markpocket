import { randomBytes, createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { encryptSecret, decryptSecret, signWebhook, getWebhookEncryptionKey } from './crypto';

afterEach(() => vi.unstubAllEnvs());
it('authenticates ciphertext and signs the exact delivered UTF-8 bytes', () => {
  const key = randomBytes(32),
    encoded = encryptSecret('secret', key);
  expect(decryptSecret(encoded, key)).toBe('secret');
  expect(encryptSecret('secret', key)).not.toBe(encoded);
  expect(() => decryptSecret(encoded, randomBytes(32))).toThrow('Webhook secret unavailable');
  const parts = encoded.split('.');
  for (const index of [1, 2, 3]) {
    const changed = [...parts];
    const bytes = Buffer.from(changed[index], 'base64');
    bytes[0] ^= 1;
    changed[index] = bytes.toString('base64');
    expect(() => decryptSecret(changed.join('.'), key)).toThrow('Webhook secret unavailable');
  }
  const body = '{"name":"中"}\n';
  expect(signWebhook('secret', '10', body)).toBe(
    createHmac('sha256', 'secret').update(`10.${body}`).digest('hex'),
  );
});
it('rejects malformed ciphertext and wrong key lengths with redacted errors', () => {
  for (const encoded of ['secret', 'v2.a.b.c', 'v1.a.b.c', 'v1....'])
    expect(() => decryptSecret(encoded, randomBytes(32))).toThrow('Webhook secret unavailable');
  for (const length of [0, 31, 33]) {
    expect(() => encryptSecret('secret', randomBytes(length))).toThrow(
      'Webhook encryption key unavailable',
    );
    expect(() => decryptSecret('secret', randomBytes(length))).toThrow(
      'Webhook secret unavailable',
    );
  }
});
it('accepts only a canonical 32-byte base64 independent encryption key', () => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'never-use-this');
  for (const value of [
    '',
    'abc',
    randomBytes(31).toString('base64'),
    randomBytes(33).toString('base64'),
    'A'.repeat(42) + 'B=',
    ' ' + randomBytes(32).toString('base64'),
  ]) {
    vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', value);
    expect(getWebhookEncryptionKey()).toBeNull();
  }
  vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', undefined);
  expect(getWebhookEncryptionKey()).toBeNull();
  const key = randomBytes(32);
  vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', key.toString('base64'));
  expect(getWebhookEncryptionKey()).toEqual(key);
});
