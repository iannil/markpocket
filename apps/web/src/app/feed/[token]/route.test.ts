/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockQuery } from '@/server/trpc/routers/__test-utils';

const publicShareMock = vi.hoisted(() => ({
  findLiveShare: vi.fn(),
  findSharedView: vi.fn(),
}));
vi.mock('@/server/trpc/routers/public-share', () => publicShareMock);

const dbQueriesMock = vi.hoisted(() => ({ listRecordsPivoted: vi.fn() }));
vi.mock('@/lib/db-queries', () => dbQueriesMock);
const viewQueryMock = vi.hoisted(() => ({ compileFilter: vi.fn(() => null) }));
vi.mock('@/lib/view-query', () => viewQueryMock);

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return { db: { select: vi.fn(() => chain) } };
});

import { GET } from './route';

const share = { id: 's1', baseId: 'b1', viewId: 'v1', token: 'tok', expiresAt: null };

beforeEach(async () => {
  vi.clearAllMocks();
  const { db } = await import('@/server/db');
  // The route's selects run base → table → fields in order; queue one result
  // per select so each resolves to the right shape.
  const queue = [
    [{ name: 'Ops Base' }],
    [{ name: 'Tasks' }],
    [
      { id: 'f1', name: 'Title', type: 'text', options: {} },
      { id: 'f2', name: 'Score', type: 'number', options: {} },
    ],
  ];
  let i = 0;
  (db.select as any).mockImplementation(() => mockQuery(queue[i++ % queue.length]));
  dbQueriesMock.listRecordsPivoted.mockResolvedValue([
    { id: 'r1', createdAt: new Date('2026-10-01T00:00:00Z'), cells: { f1: 'First task', f2: 5 } },
  ]);
});

describe('GET /feed/{token}', () => {
  it('returns RSS 2.0 XML for a live view-pinned share', async () => {
    publicShareMock.findLiveShare.mockResolvedValue(share);
    publicShareMock.findSharedView.mockResolvedValue({
      id: 'v1',
      tableId: 't1',
      options: {},
    });
    const res = await GET(new Request('http://app.local/feed/tok'), {
      params: Promise.resolve({ token: 'tok' }),
    } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('Ops Base · Tasks');
    expect(xml).toContain('<title>First task</title>');
    expect(xml).toContain('Title: First task');
  });

  it('404s for an unknown/expired share', async () => {
    publicShareMock.findLiveShare.mockResolvedValue(null);
    const res = await GET(new Request('http://app.local/feed/nope'), {
      params: Promise.resolve({ token: 'nope' }),
    } as any);
    expect(res.status).toBe(404);
  });

  it('404s for shares not pinned to a view — a feed must not widen a base-wide share', async () => {
    publicShareMock.findLiveShare.mockResolvedValue({ ...share, viewId: null });
    const res = await GET(new Request('http://app.local/feed/tok'), {
      params: Promise.resolve({ token: 'tok' }),
    } as any);
    expect(res.status).toBe(404);
    expect(publicShareMock.findSharedView).not.toHaveBeenCalled();
  });

  it('404s when the pinned view is gone or stale (fail closed)', async () => {
    publicShareMock.findLiveShare.mockResolvedValue(share);
    publicShareMock.findSharedView.mockResolvedValue(null);
    const res = await GET(new Request('http://app.local/feed/tok'), {
      params: Promise.resolve({ token: 'tok' }),
    } as any);
    expect(res.status).toBe(404);
  });

  it('clamps the limit query parameter', async () => {
    publicShareMock.findLiveShare.mockResolvedValue(share);
    publicShareMock.findSharedView.mockResolvedValue({ id: 'v1', tableId: 't1', options: {} });
    await GET(new Request('http://app.local/feed/tok?limit=99999'), {
      params: Promise.resolve({ token: 'tok' }),
    } as any);
    expect(dbQueriesMock.listRecordsPivoted).toHaveBeenCalledWith('t1', expect.anything(), 0, 100);
  });

  it('excludes hidden fields from item summaries', async () => {
    publicShareMock.findLiveShare.mockResolvedValue(share);
    publicShareMock.findSharedView.mockResolvedValue({
      id: 'v1',
      tableId: 't1',
      options: { hiddenFields: ['f2'] },
    });
    const res = await GET(new Request('http://app.local/feed/tok'), {
      params: Promise.resolve({ token: 'tok' }),
    } as any);
    const xml = await res.text();
    expect(xml).toContain('Title: First task');
    expect(xml).not.toContain('Score: 5');
  });
});
