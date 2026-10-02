/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

const tokensMock = vi.hoisted(() => ({
  resolveBearerToken: vi.fn(),
}));
vi.mock('@/server/agent-access/tokens', () => tokensMock);
vi.mock('@/server/agent-access/agent-caller', () => ({
  agentCaller: vi.fn(() => ({ base: { list: vi.fn() } })),
}));

import { handleAgentRequest, jsonOk, readJsonObject } from './http';

let tokenIdSeq = 0;
function authorize(userId = 'u1') {
  // Unique token id per call: the module-scope rate limiter is shared, and a
  // repeated id would let one test's hits bleed into the next.
  tokenIdSeq += 1;
  tokensMock.resolveBearerToken.mockResolvedValue({ tokenId: `t${tokenIdSeq}`, userId });
}

function req(url = 'http://app.local/api/v1/bases', init: RequestInit = {}) {
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('handleAgentRequest guards', () => {
  it('rejects cross-origin requests before touching auth', async () => {
    const res = await handleAgentRequest(
      req('http://app.local/api/v1/bases', {
        method: 'POST',
        headers: { origin: 'http://evil.local', host: 'app.local' },
      }),
      () => Promise.resolve(jsonOk({})),
    );
    expect(res.status).toBe(403);
    expect(tokensMock.resolveBearerToken).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies by Content-Length', async () => {
    const res = await handleAgentRequest(
      req('http://app.local/api/v1/bases', {
        method: 'POST',
        headers: { 'content-length': String(2 * 1024 * 1024) },
      }),
      () => Promise.resolve(jsonOk({})),
    );
    expect(res.status).toBe(413);
  });

  it('answers 401 with WWW-Authenticate when the token does not resolve', async () => {
    tokensMock.resolveBearerToken.mockResolvedValue(null);
    const res = await handleAgentRequest(req(), () => Promise.resolve(jsonOk({})));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('enforces the per-minute rate limit and reports 429', async () => {
    vi.stubEnv('AGENT_RATE_LIMIT_PER_MIN', '2');
    // Same token id for every call — that's the thing being exhausted.
    tokensMock.resolveBearerToken.mockResolvedValue({ tokenId: 'rate-t', userId: 'u1' });
    const handler = () => Promise.resolve(jsonOk({ ok: true }));
    const first = await handleAgentRequest(req(), handler);
    const second = await handleAgentRequest(req(), handler);
    const third = await handleAgentRequest(req(), handler);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it('0 disables the rate limit entirely', async () => {
    vi.stubEnv('AGENT_RATE_LIMIT_PER_MIN', '0');
    tokensMock.resolveBearerToken.mockResolvedValue({ tokenId: 'unlimited-t', userId: 'u1' });
    const handler = () => Promise.resolve(jsonOk({ ok: true }));
    for (let i = 0; i < 5; i++) {
      const res = await handleAgentRequest(req(), handler);
      expect(res.status).toBe(200);
    }
  });
});

describe('error mapping', () => {
  it.each([
    ['BAD_REQUEST', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
  ])('maps TRPC %s to HTTP %s', async (code, status) => {
    authorize();
    const res = await handleAgentRequest(req(), () => {
      throw new TRPCError({ code: code as any, message: 'nope' });
    });
    expect(res.status).toBe(status);
  });

  it('masks non-TRPC failures as generic 500s', async () => {
    authorize();
    const res = await handleAgentRequest(req(), () => {
      throw new Error('postgres://user:pass@host/db detail leak');
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error.message).not.toContain('postgres://');
  });
});

describe('readJsonObject', () => {
  it('rejects invalid JSON and non-object bodies', async () => {
    await expect(
      readJsonObject(new Request('http://x', { body: 'not json', method: 'POST' })),
    ).rejects.toThrow(TRPCError);
    await expect(
      readJsonObject(new Request('http://x', { body: '[1,2]', method: 'POST' })),
    ).rejects.toThrow(TRPCError);
  });
});
