/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokensMock = vi.hoisted(() => ({ resolveBearerToken: vi.fn() }));
vi.mock('@/server/agent-access/tokens', () => tokensMock);

const callerMock = vi.hoisted(() => ({
  record: { list: vi.fn(), create: vi.fn() },
  cell: { upsert: vi.fn() },
}));
vi.mock('@/server/agent-access/agent-caller', () => ({
  agentCaller: vi.fn(() => callerMock),
}));

const dbQueriesMock = vi.hoisted(() => ({ listRecordsPivoted: vi.fn() }));
vi.mock('@/lib/db-queries', () => dbQueriesMock);
const rolesMock = vi.hoisted(() => ({ assertTableRole: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/roles', () => rolesMock);
vi.mock('@/server/db', async () => {
  const { mockQuery } = await import('@/server/trpc/routers/__test-utils');
  const chain = mockQuery([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
    },
  };
});

import { GET, POST } from './route';

function req(url: string, init: RequestInit = {}) {
  return new Request(url, init);
}

beforeEach(async () => {
  vi.clearAllMocks();
  tokensMock.resolveBearerToken.mockResolvedValue({ tokenId: `t-${Math.random()}`, userId: 'u1' });
  callerMock.record.list.mockResolvedValue({ groups: [], total: 0 });
  callerMock.record.create.mockResolvedValue({ id: 'r1', tableId: 'tb1' });
  callerMock.cell.upsert.mockResolvedValue(undefined);
  dbQueriesMock.listRecordsPivoted.mockResolvedValue([{ id: 'r1', cells: {} }]);
  rolesMock.assertTableRole.mockResolvedValue(undefined);
  const { db } = await import('@/server/db');
  const { mockQuery } = await import('@/server/trpc/routers/__test-utils');
  (db.select as any).mockReturnValue(
    mockQuery([{ id: 'r1', tableId: 'tb1', createdAt: new Date(), updatedAt: new Date() }]),
  );
});

describe('GET /api/v1/tables/{tableId}/records', () => {
  it('passes pagination and viewId through to record.list', async () => {
    const res = await GET(
      req('http://app.local/api/v1/tables/tb1/records?offset=10&limit=5&viewId=v2'),
      {
        params: Promise.resolve({ tableId: 'tb1' }),
      } as any,
    );
    expect(res.status).toBe(200);
    expect(callerMock.record.list).toHaveBeenCalledWith({
      tableId: 'tb1',
      offset: 10,
      limit: 5,
      viewId: 'v2',
    });
  });

  it('rejects out-of-range pagination', async () => {
    const res = await GET(req('http://app.local/api/v1/tables/tb1/records?limit=9999'), {
      params: Promise.resolve({ tableId: 'tb1' }),
    } as any);
    expect(res.status).toBe(400);
  });

  it('requires a Bearer token', async () => {
    tokensMock.resolveBearerToken.mockResolvedValue(null);
    const res = await GET(req('http://app.local/api/v1/tables/tb1/records'), {
      params: Promise.resolve({ tableId: 'tb1' }),
    } as any);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/tables/{tableId}/records', () => {
  it('creates a record with cells and returns 201', async () => {
    const res = await POST(
      req('http://app.local/api/v1/tables/tb1/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cells: { f1: 'hello' } }),
      }),
      { params: Promise.resolve({ tableId: 'tb1' }) } as any,
    );
    expect(res.status).toBe(201);
    expect(callerMock.record.create).toHaveBeenCalledWith({ tableId: 'tb1' });
    expect(callerMock.cell.upsert).toHaveBeenCalledWith({
      recordId: 'r1',
      fieldId: 'f1',
      value: 'hello',
    });
  });

  it('answers 400 for a non-object body', async () => {
    const res = await POST(
      req('http://app.local/api/v1/tables/tb1/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2]),
      }),
      { params: Promise.resolve({ tableId: 'tb1' }) } as any,
    );
    expect(res.status).toBe(400);
  });
});
