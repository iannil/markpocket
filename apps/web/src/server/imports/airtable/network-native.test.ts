import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));

import { nativeRequest } from './network';

type LookupResult = { address: string; family: number }[] | string;
type LookupCallback = (error: Error | null, addresses: LookupResult, family?: number) => void;
type LookupOptions = { all: boolean; family?: number };

describe('native HTTPS transport', () => {
  it('returns the pinned address in Node 24 lookup all mode', async () => {
    requestMock.mockImplementation(
      (
        _url: URL,
        options: {
          lookup: (hostname: string, options: LookupOptions, callback: LookupCallback) => void;
          servername: string;
        },
        onResponse: (response: Readable) => void,
      ) => {
        const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
        req.destroy = () => {};
        req.end = () => {
          expect(options.servername).toBe('v5.airtableusercontent.com');
          options.lookup('v5.airtableusercontent.com', { all: true }, (error, addresses) => {
            if (error || !Array.isArray(addresses)) {
              req.emit('error', error ?? new Error('ERR_INVALID_IP_ADDRESS'));
              return;
            }
            expect(addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
            const response = Object.assign(Readable.from([Buffer.from('ok')]), {
              statusCode: 200,
              headers: {},
            });
            onResponse(response);
          });
        };
        return req;
      },
    );
    const response = await nativeRequest(
      new URL('https://v5.airtableusercontent.com/file'),
      { address: '8.8.8.8', family: 4 },
      {},
      new AbortController().signal,
      10,
    );
    expect(response.body.toString()).toBe('ok');
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
