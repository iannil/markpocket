/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

// db mock: every db.select() call pops the next configured result, in call
// order. Each call gets a fresh chain so per-call results stay independent.
function selectQueueDb(values: unknown[][]) {
  let i = 0;
  return {
    select: vi.fn(() => {
      const v = values[Math.min(i++, values.length - 1)] ?? [];
      const chain: Record<string, any> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        then: (onfulfilled: any) => Promise.resolve(v).then(onfulfilled),
      };
      return chain;
    }),
  };
}

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@/server/db', () => ({ db: dbMock }));
vi.mock('@/lib/db-queries', () => ({
  listRecordsPivoted: vi.fn().mockResolvedValue([
    { id: 'r1', cells: { f1: 'public', f2: 'secret' } },
    { id: 'r2', cells: { f1: 'also-public' } },
  ]),
  countRecords: vi.fn().mockResolvedValue(2),
}));

import { publicShareRouter } from './public-share';
import { listRecordsPivoted, countRecords } from '@/lib/db-queries';

function queueSelects(values: unknown[][]) {
  const q = selectQueueDb(values);
  (dbMock.select as any).mockImplementation(q.select);
}

const SHARE = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  baseId: 'b1',
  viewId: null,
  token: 'tok',
  expiresAt: null,
  createdAt: new Date(),
  createdBy: 'u1',
  ...over,
});
const TABLE_ROW = { id: 't1', baseId: 'b1' };
const FIELDS = [
  { id: 'f1', name: 'Visible', type: 'text', options: {} },
  { id: 'f2', name: 'Secret', type: 'text', options: {} },
];

describe('publicShareRouter — base-level share (no viewId)', () => {
  it('returns null for invalid token', async () => {
    queueSelects([[]]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('getTables returns all tables of the base', async () => {
    queueSelects([
      [SHARE()],
      [
        { id: 't1', name: 'T1' },
        { id: 't2', name: 'T2' },
      ],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getTables({ token: 'tok' });
    expect(result).toHaveLength(2);
  });

  it('getRecords returns all fields and cells', async () => {
    queueSelects([[SHARE()], [TABLE_ROW], FIELDS]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1' });
    expect(result).not.toBeNull();
    expect(result!.fields).toHaveLength(2);
    expect(result!.records[0]!.cells).toEqual({ f1: 'public', f2: 'secret' });
  });

  it('getRecords returns null when the table belongs to another base', async () => {
    queueSelects([[SHARE()], [{ id: 't9', baseId: 'other-base' }]]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't9' });
    expect(result).toBeNull();
  });

  it('getRecords passes offset through to the underlying query (paging)', async () => {
    (listRecordsPivoted as any).mockClear();
    queueSelects([[SHARE()], [TABLE_ROW], FIELDS]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1', limit: 50, offset: 150 });
    expect(result).not.toBeNull();
    // listRecordsPivoted(tableId, opts, offset, limit) — offset must flow so
    // the share page can append pages instead of growing the limit forever.
    expect(listRecordsPivoted).toHaveBeenCalledWith('t1', {}, 150, 50);
  });

  it('getRecords defaults offset to 0 when omitted', async () => {
    (listRecordsPivoted as any).mockClear();
    queueSelects([[SHARE()], [TABLE_ROW], FIELDS]);
    await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1' });
    expect(listRecordsPivoted).toHaveBeenCalledWith('t1', {}, 0, 100);
  });

  it('getRecords rejects an out-of-range offset', async () => {
    await expect(
      publicShareRouter.createCaller({ session: null }).getRecords({
        token: 'tok',
        tableId: 't1',
        offset: -1,
      }),
    ).rejects.toThrow();
    await expect(
      publicShareRouter.createCaller({ session: null }).getRecords({
        token: 'tok',
        tableId: 't1',
        offset: 1_000_001,
      }),
    ).rejects.toThrow();
  });
});

describe('publicShareRouter — view-bound share', () => {
  it('getTables returns only the view own table', async () => {
    // Select order: share → findSharedView (view row) → the view's table.
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [{ id: 'v1', tableId: 't1', options: {} }],
      [{ id: 't1', name: 'T1' }],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getTables({ token: 'tok' });
    expect(result).toEqual([{ id: 't1', name: 'T1' }]);
  });

  it('getTables returns [] when the bound view was deleted', async () => {
    // Second select (findSharedView) finds no row for a deleted view.
    queueSelects([[SHARE({ viewId: 'gone' })], []]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getTables({ token: 'tok' });
    expect(result).toEqual([]);
  });

  it('getTables returns [] when the view options fail strict validation', async () => {
    // Same fail-closed rule as getBase's null and getRecords' null: a share
    // pinned to a view whose stored options the current schema rejects must
    // expose nothing — not even the base's table names.
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [
        {
          id: 'v1',
          tableId: 't1',
          // Legacy shape the current schema rejects (unknown operator).
          options: { filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'wat' }] } },
        },
      ],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getTables({ token: 'tok' });
    expect(result).toEqual([]);
  });

  it('getBase resolves for a live view-bound share', async () => {
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [{ id: 'b1', name: 'Base', icon: '📁' }],
      [{ id: 'v1', tableId: 't1', options: {} }],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'tok' });
    // Display-only projection: no internal row ids on the public surface.
    expect(result).toEqual({ name: 'Base', icon: '📁', viewId: 'v1' });
  });

  it('getBase returns null when the bound view was deleted', async () => {
    queueSelects([[SHARE({ viewId: 'gone' })], [{ id: 'b1', name: 'Base', icon: null }], []]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'tok' });
    expect(result).toBeNull();
  });

  it('getBase returns null when the view options fail strict validation', async () => {
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [{ id: 'b1', name: 'Base', icon: null }],
      // Legacy shape the current schema rejects (unknown operator).
      [
        {
          id: 'v1',
          tableId: 't1',
          options: { filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'wat' }] } },
        },
      ],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'tok' });
    expect(result).toBeNull();
  });

  it('getRecords returns null when the bound view was deleted', async () => {
    queueSelects([[SHARE({ viewId: 'gone' })], [TABLE_ROW], FIELDS, []]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1' });
    expect(result).toBeNull();
  });

  it('getRecords returns null for a table other than the view own', async () => {
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [TABLE_ROW],
      FIELDS,
      [{ id: 'v1', tableId: 't2', options: {} }], // view belongs to t2, request is for t1
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1' });
    expect(result).toBeNull();
  });

  it('getRecords returns null — never the full table — when stored options fail strict validation', async () => {
    (listRecordsPivoted as any).mockClear();
    (countRecords as any).mockClear();
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [TABLE_ROW],
      FIELDS,
      [
        {
          id: 'v1',
          tableId: 't1',
          // Legacy shape: an operand longer than today's 1000-char cap, plus
          // a hidden field. The tolerant parse would degrade to {} (no
          // filter, no hiddenFields) and silently expose the whole table —
          // strict parsing must fail the share closed instead (review M-1).
          options: {
            hiddenFields: ['f2'],
            filter: {
              op: 'and',
              conditions: [{ fieldId: 'f2', operator: 'equals', operand: 'x'.repeat(1001) }],
            },
          },
        },
      ],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1' });
    expect(result).toBeNull();
    // No query may run — the fallback must not leak an unfiltered listing.
    expect(listRecordsPivoted).not.toHaveBeenCalled();
    expect(countRecords).not.toHaveBeenCalled();
  });

  it.each(['grid', 'kanban'])(
    '%s strips hidden field metadata and cells while keeping the filter active',
    async (type) => {
      (listRecordsPivoted as any).mockClear();
      queueSelects([
        [SHARE({ viewId: 'v1' })],
        [TABLE_ROW],
        FIELDS,
        [
          {
            id: 'v1',
            tableId: 't1',
            type,
            // Filter on the hidden field must still constrain the query.
            options: {
              hiddenFields: ['f2'],
              filter: {
                op: 'and',
                conditions: [{ fieldId: 'f2', operator: 'equals', operand: 'x' }],
              },
            },
          },
        ],
      ]);
      const result = await publicShareRouter
        .createCaller({ session: null })
        .getRecords({ token: 'tok', tableId: 't1' });
      expect(result).not.toBeNull();
      // Hidden field dropped from metadata…
      expect(result!.fields.map((f: { id: string }) => f.id)).toEqual(['f1']);
      // …and from every record's cells…
      expect(result!.records[0]!.cells).toEqual({ f1: 'public' });
      expect(result!.records[1]!.cells).toEqual({ f1: 'also-public' });
      // …but the filter compiled against the FULL field map (non-null where).
      const opts = (listRecordsPivoted as any).mock.calls[0]![1];
      expect(opts.where).not.toBeNull();
    },
  );

  it('passes offset through on the view-bound path too', async () => {
    (listRecordsPivoted as any).mockClear();
    queueSelects([
      [SHARE({ viewId: 'v1' })],
      [TABLE_ROW],
      FIELDS,
      [{ id: 'v1', tableId: 't1', options: {} }],
    ]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getRecords({ token: 'tok', tableId: 't1', limit: 25, offset: 75 });
    expect(result).not.toBeNull();
    const call = (listRecordsPivoted as any).mock.calls[0]!;
    expect(call[0]).toBe('t1');
    expect(call[2]).toBe(75);
    expect(call[3]).toBe(25);
  });
});

describe('publicShareRouter — expiry', () => {
  it('treats an expired share as invalid', async () => {
    queueSelects([[SHARE({ expiresAt: new Date(Date.now() - 1000) })]]);
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'tok' });
    expect(result).toBeNull();
  });
});

it('rejects a legacy share pinned to a Form view on every read surface', async () => {
  const caller = publicShareRouter.createCaller({ session: null });
  const form = { id: 'v1', tableId: 't1', type: 'form', options: {} };
  queueSelects([[SHARE({ viewId: 'v1' })], [{ id: 'b1', name: 'Base' }], [form]]);
  expect(await caller.getBase({ token: 'tok' })).toBeNull();
  queueSelects([[SHARE({ viewId: 'v1' })], [form]]);
  expect(await caller.getTables({ token: 'tok' })).toEqual([]);
  queueSelects([[SHARE({ viewId: 'v1' })], [TABLE_ROW], FIELDS, [form]]);
  expect(await caller.getRecords({ token: 'tok', tableId: 't1' })).toBeNull();
});

it('RSS rejects a legacy Form share through the real shared-view resolver before reading records', async () => {
  vi.mocked(listRecordsPivoted).mockClear();
  queueSelects([
    [SHARE({ viewId: 'v1' })],
    [{ id: 'v1', tableId: 't1', type: 'form', options: {} }],
  ]);
  const { GET } = await import('../../../app/feed/[token]/route');
  const response = await GET(new Request('http://app.local/feed/tok'), {
    params: Promise.resolve({ token: 'tok' }),
  });
  expect(response.status).toBe(404);
  expect(listRecordsPivoted).not.toHaveBeenCalled();
});
