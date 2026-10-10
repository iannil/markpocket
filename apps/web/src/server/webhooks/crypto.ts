import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/** A missing or invalid dedicated key disables webhooks; never use the session key. */
export function getWebhookEncryptionKey(): Buffer | null {
  const encoded = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length === 32 && key.toString('base64') === encoded ? key : null;
}

export function encryptSecret(secret: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Webhook encryption key unavailable');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  try {
    const parts = ciphertext.split('.');
    if (key.length !== 32 || parts.length !== 4 || parts[0] !== 'v1') throw new Error();
    const buffers = parts.slice(1).map((encoded) => {
      const buffer = Buffer.from(encoded, 'base64');
      if (buffer.toString('base64') !== encoded) throw new Error();
      return buffer;
    });
    const [iv, tag, body] = buffers;
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
  } catch {
    throw new Error('Webhook secret unavailable');
  }
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}
