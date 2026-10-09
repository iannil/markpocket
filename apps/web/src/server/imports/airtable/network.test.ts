import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import {
  collectBoundedStream,
  isPublicAddress,
  secureRequest,
  validateAttachmentUrl,
  type Resolver,
} from './network';

const publicResolver: Resolver = async () => [{ address: '8.8.8.8', family: 4 }];

describe('attachment network boundary', () => {
  it.each([
    'http://v5.airtableusercontent.com/a',
    'https://airtableusercontent.com.evil.test/a',
    'https://user:pass@v5.airtableusercontent.com/a',
    'https://127.0.0.1/a',
    'https://v5.airtableusercontent.com:444/a',
  ])('rejects URL %s', async (url) => {
    await expect(validateAttachmentUrl(url, publicResolver)).rejects.toThrow();
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ])('rejects nonpublic %s', async (address) => {
    expect(isPublicAddress(address)).toBe(false);
    await expect(
      validateAttachmentUrl('https://v5.airtableusercontent.com/file', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
    ).rejects.toThrow();
  });

  it('rejects mixed DNS and pins the validated address', async () => {
    const request = vi.fn(async (_url, address) => ({
      status: 200,
      headers: {},
      body: Buffer.from(address.address),
    }));
    const url = new URL('https://v5.airtableusercontent.com/file');
    await expect(
      secureRequest(url, {}, new AbortController().signal, 100, {
        resolve: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        request,
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const response = await secureRequest(url, {}, new AbortController().signal, 100, {
      resolve: publicResolver,
      request,
    });
    expect(response.body.toString()).toBe('8.8.8.8');
  });

  it('rejects redirects and oversized responses', async () => {
    const url = new URL('https://v5.airtableusercontent.com/file');
    await expect(
      secureRequest(url, {}, new AbortController().signal, 10, {
        resolve: publicResolver,
        request: async () => ({
          status: 302,
          headers: { location: 'https://evil.test/' },
          body: Buffer.alloc(0),
        }),
      }),
    ).rejects.toThrow('Redirect rejected');
    await expect(
      secureRequest(url, {}, new AbortController().signal, 10, {
        resolve: publicResolver,
        request: async () => ({ status: 200, headers: {}, body: Buffer.alloc(11) }),
      }),
    ).rejects.toThrow('byte limit');
  });

  it('counts streamed chunks rather than trusting a length header', async () => {
    const stream = Readable.from([Buffer.alloc(5), Buffer.alloc(6)]);
    await expect(collectBoundedStream(stream, 10, new AbortController().signal)).rejects.toThrow(
      'byte limit',
    );
    await expect(
      collectBoundedStream(
        Readable.from([Buffer.alloc(5), Buffer.alloc(5)]),
        10,
        new AbortController().signal,
      ),
    ).resolves.toHaveLength(10);
  });

  it('aborts while DNS is pending', async () => {
    const controller = new AbortController();
    const pending = secureRequest(
      new URL('https://v5.airtableusercontent.com/file'),
      {},
      controller.signal,
      10,
      {
        resolve: async () => new Promise(() => {}),
        request: async () => {
          throw new Error('Request should not start');
        },
      },
    );
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
});
