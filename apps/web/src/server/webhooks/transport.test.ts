import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { request } from 'node:https';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebhookTransport, parseWebhookUrl } from './transport';

afterEach(() => vi.useRealTimers());
const publicAddress = { address: '8.8.8.8', family: 4 as const };
function fixture(status = 204, chunks: Buffer[] = []) {
  const response = Object.assign(Readable.from(chunks), {
    statusCode: status,
    headers: { location: 'http://127.0.0.1/' },
  });
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  req.end.mockImplementation(() => handler(response));
  let handler: (response: Readable) => void;
  const requestMock = vi.fn((_url: URL, _options: RequestOptions, callback: typeof handler) => {
    handler = callback;
    return req;
  });
  const resolve = vi.fn(async () => [publicAddress]);
  return {
    response,
    req,
    requestMock,
    resolve,
    post: createWebhookTransport({ resolve, request: requestMock as unknown as typeof request }),
  };
}
const signal = () => new AbortController().signal;

describe('webhook transport', () => {
  it.each([
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/#x',
    'https://example.com/#',
    'https://example.com:444',
    'https://127.0.0.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://169.254.169.254',
    'https://example.com/' + 'a'.repeat(2048),
  ])('rejects invalid/unsafe target %s', async (url) => {
    const f = fixture();
    await expect(f.post(url, '{}', {}, signal())).rejects.toThrow();
    expect(f.requestMock).not.toHaveBeenCalled();
  });
  it('pins validated DNS in both lookup modes while preserving TLS host, exact body and query', async () => {
    const f = fixture();
    const body = '{"name":"中"}';
    expect(
      await f.post(
        'https://example.com:443/hook?token=private',
        body,
        { 'X-MarkPocket-Event': 'event', hOsT: 'evil.com' },
        signal(),
      ),
    ).toEqual({ status: 204 });
    const [url, options] = f.requestMock.mock.calls[0];
    expect(url.search).toBe('?token=private');
    expect(options.servername).toBe('example.com');
    expect(options.method).toBe('POST');
    expect(options.agent).toBe(false);
    expect(options.headers).toMatchObject({
      Host: 'example.com',
      'Content-Length': String(Buffer.byteLength(body)),
    });
    expect(options.headers).not.toHaveProperty('hOsT');
    const cb = vi.fn();
    options.lookup!('example.com', { all: true }, cb);
    expect(cb).toHaveBeenLastCalledWith(null, [publicAddress]);
    options.lookup!('example.com', {}, cb);
    expect(cb).toHaveBeenLastCalledWith(null, '8.8.8.8', 4);
    expect(f.req.end).toHaveBeenCalledWith(body);
    expect(f.resolve).toHaveBeenCalledOnce();
  });
  it('rejects empty, malformed and mixed DNS answers and revalidates every send', async () => {
    for (const answers of [
      [],
      [publicAddress, { address: '10.0.0.1', family: 4 }],
      [{ address: '8.8.8.8', family: 6 }],
    ]) {
      const f = fixture();
      f.resolve.mockResolvedValue(answers as (typeof publicAddress)[]);
      await expect(f.post('https://example.com', '{}', {}, signal())).rejects.toThrow(
        'Webhook address is not public',
      );
      expect(f.requestMock).not.toHaveBeenCalled();
    }
    const f = fixture();
    await f.post('https://example.com', '{}', {}, signal());
    f.resolve.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(f.post('https://example.com', '{}', {}, signal())).rejects.toThrow();
    expect(f.requestMock).toHaveBeenCalledOnce();
  });
  it('returns redirect status without following any Location', async () => {
    const f = fixture(302);
    expect(await f.post('https://example.com', '{}', {}, signal())).toEqual({ status: 302 });
    expect(f.requestMock).toHaveBeenCalledOnce();
  });
  it('allows exactly 64 KiB and destroys oversized response/request', async () => {
    const good = fixture(200, [Buffer.alloc(65536)]);
    expect(await good.post('https://example.com', '{}', {}, signal())).toEqual({ status: 200 });
    const bad = fixture(200, [Buffer.alloc(65536), Buffer.alloc(1)]);
    await expect(bad.post('https://example.com', '{}', {}, signal())).rejects.toThrow(
      'Webhook response exceeds byte limit',
    );
    expect(bad.req.destroy).toHaveBeenCalled();
    expect(bad.response.destroyed).toBe(true);
  });
  it('bounds DNS to five seconds, honors cancellation and redacts upstream errors', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.resolve.mockImplementation(() => new Promise(() => {}));
    const pending = expect(
      f.post('https://example.com/?private', '{}', {}, signal()),
    ).rejects.toThrow('Webhook request cancelled');
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(f.requestMock).not.toHaveBeenCalled();
    const aborted = AbortSignal.abort();
    await expect(f.post('https://example.com', '{}', {}, aborted)).rejects.toThrow(
      'Webhook request cancelled',
    );
    const error = fixture();
    error.resolve.mockRejectedValue(new Error('secret query'));
    await expect(error.post('https://example.com/?private', '{}', {}, signal())).rejects.toThrow(
      'Webhook DNS lookup failed',
    );
    expect(parseWebhookUrl('https://example.com?x=1').search).toBe('?x=1');
  });
  it('aborts an in-flight response at five seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.req.end.mockImplementation(() => {});
    const pending = expect(f.post('https://example.com', '{}', {}, signal())).rejects.toThrow(
      'Webhook request cancelled',
    );
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(f.req.destroy).toHaveBeenCalled();
  });
});
