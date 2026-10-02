/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

// The route must be testable without the real router tree (db, auth, plugins).
vi.mock('@/server/trpc/router', () => ({ appRouter: {} }));
vi.mock('@/server/trpc/init', () => ({ createContext: vi.fn() }));
vi.mock('@trpc/server/adapters/fetch', () => ({
  fetchRequestHandler: vi.fn().mockResolvedValue(new Response('ok')),
}));

import { GET, POST } from './route';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

const MB = 1024 * 1024;

function trpcRequest(contentLength?: string, origin?: string, body?: BodyInit) {
  const headers: Record<string, string> = { host: 'app.local' };
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  if (origin !== undefined) headers.origin = origin;
  // A constructed Request never carries Content-Length of its own — only the
  // explicitly passed header (if any) is visible, which is exactly what the
  // chunked tests below rely on.
  return new Request('http://app.local/api/trpc/publicShare.getBase', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

describe('tRPC route — body size gate (review Medium-1)', () => {
  it('rejects a POST body over 12MB with 413 before the adapter parses it', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await POST(trpcRequest(String(13 * MB)));
    expect(res.status).toBe(413);
    expect(fetchRequestHandler).not.toHaveBeenCalled();
  });

  it('accepts a POST at exactly the 12MB cap on the Content-Length fast path', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await POST(trpcRequest(String(12 * MB)));
    expect(res.status).toBe(200);
    expect(fetchRequestHandler).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized GET the same way (shared handler)', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await GET(trpcRequest(String(30 * MB)));
    expect(res.status).toBe(413);
    expect(fetchRequestHandler).not.toHaveBeenCalled();
  });

  it('passes a normal-sized POST through to the adapter', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await POST(trpcRequest('2048'));
    expect(res.status).toBe(200);
    expect(fetchRequestHandler).toHaveBeenCalledTimes(1);
  });

  it('still refuses cross-origin requests before anything else', async () => {
    const res = await POST(trpcRequest(String(13 * MB), 'http://evil.com'));
    expect(res.status).toBe(403);
  });
});

describe('tRPC route — chunked requests (no Content-Length, review Medium-3)', () => {
  it('413s a large chunked body before the adapter buffers it', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await POST(trpcRequest(undefined, undefined, 'x'.repeat(13 * MB)));
    expect(res.status).toBe(413);
    expect(fetchRequestHandler).not.toHaveBeenCalled();
  });

  it('hands a small chunked body to the adapter intact', async () => {
    (fetchRequestHandler as any).mockClear();
    const payload = '{"0":{"tableId":"t1","csvText":"a,b\\n1,2"}}';
    const res = await POST(trpcRequest(undefined, undefined, payload));
    expect(res.status).toBe(200);
    expect(fetchRequestHandler).toHaveBeenCalledTimes(1);
    // The rebuilt Request the adapter received must carry the full body and
    // the original headers — a dropped content-type would break JSON parsing.
    const passed = (fetchRequestHandler as any).mock.calls[0][0].req as Request;
    expect(await passed.text()).toBe(payload);
    expect(passed.headers.get('host')).toBe('app.local');
  });

  it('lets a body-less chunked POST through untouched (empty POST)', async () => {
    (fetchRequestHandler as any).mockClear();
    const res = await POST(trpcRequest(undefined));
    expect(res.status).toBe(200);
    expect(fetchRequestHandler).toHaveBeenCalledTimes(1);
  });
});
