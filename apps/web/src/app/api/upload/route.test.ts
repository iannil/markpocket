/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({
  // Minimal insert().values().returning() chain; the values() call is echoed
  // into the returning row so tests can assert exactly what was persisted.
  // select() backs the per-user quota SUM — tests override its total via
  // withSession(usedBytes).
  db: {
    // insert wrapped in vi.fn so quota tests can assert "never persisted".
    insert: vi.fn(() => ({
      values: (v: any) => ({
        returning: async () => [{ id: 'a1', filename: v.filename }],
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: async () => [{ total: '0' }],
      }),
    })),
  },
}));
vi.mock('@/server/plugins', () => ({ getStorage: vi.fn() }));
vi.mock('@/server/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/roles', () => ({ assertRole: vi.fn().mockResolvedValue(undefined) }));

import { POST } from './route';
import { auth } from '@/server/auth';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';

const MB = 1024 * 1024;

function uploadRequest(contentLength?: string, origin?: string) {
  const headers: Record<string, string> = { host: 'app.local' };
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  if (origin !== undefined) headers.origin = origin;
  return new Request('http://app.local/api/upload', { method: 'POST', headers });
}

// A chunked-shaped multipart upload: no Content-Length header, the multipart
// bytes snapshotted from a FormData so the content-type carries a real
// boundary the rebuild must preserve.
async function chunkedUpload(filename: string, content = 'hello world'): Promise<Request> {
  const fd = new FormData();
  fd.append('file', new File([content], filename, { type: 'text/plain' }));
  fd.append('baseId', 'b1');
  const preview = new Response(fd);
  const contentType = preview.headers.get('content-type')!;
  const raw = await preview.arrayBuffer();
  return new Request('http://app.local/api/upload', {
    method: 'POST',
    headers: { host: 'app.local', 'content-type': contentType },
    body: raw,
  });
}

// put is captured so quota tests can assert the file never reached storage.
let put: ReturnType<typeof vi.fn>;

function withSession(usedBytes = 0) {
  (auth.api.getSession as any).mockReset();
  (auth.api.getSession as any).mockResolvedValue({ user: { id: 'u1' } });
  // Call counts must not leak between tests (the quota suite asserts
  // "never persisted").
  (db.insert as any).mockClear();
  // Postgres SUM(bigint) arrives as a string — the mock mirrors that.
  (db.select as any).mockImplementation(() => ({
    from: () => ({
      where: async () => [{ total: String(usedBytes) }],
    }),
  }));
  put = vi.fn().mockResolvedValue(undefined);
  (getStorage as any).mockReturnValue({
    makeKey: (name: string) => `k/${name}`,
    put,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upload route — body size gate (review Medium-1)', () => {
  it('rejects over-55MB bodies with 413 before auth or formData buffering', async () => {
    (auth.api.getSession as any).mockClear();
    const res = await POST(uploadRequest(String(60 * MB)));
    expect(res.status).toBe(413);
    // Gate must fire before the session lookup — no work past the gate.
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('lets an under-limit body continue to auth (401 without session)', async () => {
    (auth.api.getSession as any).mockReset();
    (auth.api.getSession as any).mockResolvedValue(null);
    const res = await POST(uploadRequest(String(10 * MB)));
    expect(res.status).toBe(401);
    expect(auth.api.getSession).toHaveBeenCalledTimes(1);
  });

  it('lets an empty chunked POST continue to auth', async () => {
    (auth.api.getSession as any).mockReset();
    (auth.api.getSession as any).mockResolvedValue(null);
    const res = await POST(uploadRequest(undefined));
    expect(res.status).toBe(401);
    expect(auth.api.getSession).toHaveBeenCalledTimes(1);
  });

  it('still refuses cross-origin uploads first', async () => {
    const res = await POST(uploadRequest(String(60 * MB), 'http://evil.com'));
    expect(res.status).toBe(403);
  });
});

describe('upload route — chunked bodies (review Medium-3)', () => {
  it('authenticates before buffering, then 413s a large chunked body', async () => {
    // Review round-5 M-1: readBodyWithCap holds up to 55MB in memory, so it
    // must only run for an authenticated caller — getSession (headers-only)
    // comes first, the buffering 413 after.
    (auth.api.getSession as any).mockReset();
    (auth.api.getSession as any).mockResolvedValue({ user: { id: 'u1' } });
    const req = new Request('http://app.local/api/upload', {
      method: 'POST',
      headers: { host: 'app.local', 'content-type': 'application/json' },
      body: 'x'.repeat(56 * MB),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(auth.api.getSession).toHaveBeenCalledTimes(1);
  });

  it('refuses an unauthenticated chunked body before any buffering (401)', async () => {
    (auth.api.getSession as any).mockReset();
    (auth.api.getSession as any).mockResolvedValue(null);
    const req = new Request('http://app.local/api/upload', {
      method: 'POST',
      headers: { host: 'app.local', 'content-type': 'application/json' },
      // Would blow the memory assertion if buffered: readBodyWithCap is
      // unreachable without a session, so even a huge stream is never read.
      body: 'x'.repeat(56 * MB),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(auth.api.getSession).toHaveBeenCalledTimes(1);
  });

  it('round-trips a small chunked multipart upload (boundary survives the rebuild)', async () => {
    (auth.api.getSession as any).mockReset();
    withSession();
    // A long CJK name doubles as the truncation test: 60K chars must land
    // in storage/DB at ≤255 UTF-8 bytes, and the rebuilt multipart body must
    // still parse (formData) with its boundary intact.
    const res = await POST(await chunkedUpload('长'.repeat(60_000) + '.txt'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; filename: string };
    expect(body.id).toBe('a1');
    expect(Buffer.byteLength(body.filename, 'utf8')).toBeLessThanOrEqual(255);
    expect(body.filename.startsWith('长')).toBe(true);
    expect(body.filename.endsWith('.txt')).toBe(false); // cut off — accepted trade-off
  });

  it('keeps an in-budget filename byte-for-byte', async () => {
    (auth.api.getSession as any).mockReset();
    withSession();
    const res = await POST(await chunkedUpload('report.pdf'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { filename: string }).filename).toBe('report.pdf');
  });
});

describe('upload route — per-user total quota (M-1)', () => {
  it('admits an upload while used + incoming stays within the quota', async () => {
    vi.stubEnv('UPLOAD_USER_QUOTA_MB', '2');
    // 2MB quota, 1MB already used, an 11-byte file: inside.
    withSession(1 * MB);
    const res = await POST(await chunkedUpload('small.txt'));
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('rejects with 413 when used + incoming exceeds the quota, before storage', async () => {
    vi.stubEnv('UPLOAD_USER_QUOTA_MB', '1');
    // 1MB quota fully used already — even a tiny file must not fit.
    withSession(1 * MB);
    const res = await POST(await chunkedUpload('small.txt'));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/quota/i) });
    // The rejection must land BEFORE anything is persisted.
    expect(put).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('UPLOAD_USER_QUOTA_MB=0 disables the cap entirely', async () => {
    vi.stubEnv('UPLOAD_USER_QUOTA_MB', '0');
    // "Used" far beyond any default quota — 0 must let it through.
    withSession(9999 * MB);
    const res = await POST(await chunkedUpload('uncapped.txt'));
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('falls back to the 2048MB default on a malformed value', async () => {
    vi.stubEnv('UPLOAD_USER_QUOTA_MB', 'not-a-number');
    // 3GB "used" would exceed the 2048MB default; a NaN env must not widen
    // the cap into "unlimited".
    withSession(3 * 1024 * MB);
    const res = await POST(await chunkedUpload('small.txt'));
    expect(res.status).toBe(413);
  });
});
