/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokensMock = vi.hoisted(() => ({ resolveBearerToken: vi.fn() }));
vi.mock('@/server/agent-access/tokens', () => tokensMock);
const callerMock = vi.hoisted(() => ({ base: { list: vi.fn() } }));
vi.mock('@/server/agent-access/agent-caller', () => ({
  agentCaller: vi.fn(() => callerMock),
}));
// tools.ts → records-service → db at import time; the real db module throws
// without DATABASE_URL.
vi.mock('@/server/db', () => ({ db: {} }));

import { DELETE, GET, POST } from './route';

function mcpPost(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://app.local/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tokensMock.resolveBearerToken.mockResolvedValue({ tokenId: `t-${Math.random()}`, userId: 'u1' });
  callerMock.base.list.mockResolvedValue([{ id: 'b1', name: 'Ops' }]);
});

describe('POST /api/mcp', () => {
  it('completes the initialize handshake over HTTP', async () => {
    const res = await POST(
      mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.serverInfo.name).toBe('markpocket');
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('answers 401 with WWW-Authenticate when the token does not resolve', async () => {
    tokensMock.resolveBearerToken.mockResolvedValue(null);
    const res = await POST(mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers -32700 for a body that is not valid JSON', async () => {
    const res = await POST(mcpPost('{nope'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32700);
  });

  it('answers -32600 for batches — single-message server by design', async () => {
    const res = await POST(mcpPost([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32600);
  });

  it('returns 202 with no body for notifications', async () => {
    const res = await POST(mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('runs a tools/call end to end', async () => {
    const res = await POST(
      mcpPost({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_bases' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(JSON.parse(body.result.content[0].text)).toEqual([{ id: 'b1', name: 'Ops' }]);
  });

  it('rejects cross-origin posts', async () => {
    const res = await POST(
      mcpPost(
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { origin: 'http://evil.local', host: 'app.local' },
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe('GET/DELETE /api/mcp', () => {
  it('declines the SSE stream and session termination with 405', async () => {
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });
});
