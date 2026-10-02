/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './__test-utils';

const mockDb = vi.hoisted(() => {
  function mockQuery<T>(resolveValue: T) {
    const chain: Record<string, any> & PromiseLike<T> = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      set: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      values: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      // assertLinkTargetInBase locks the target row with .for('update').
      for: vi.fn(() => chain),
      execute: vi.fn().mockResolvedValue([]),
      then: (onfulfilled: (v: T) => any) => Promise.resolve(resolveValue).then(onfulfilled),
      catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
    };
    return chain;
  }
  return { chain: mockQuery([]), mockQuery };
});
vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => mockDb.chain),
    insert: vi.fn(() => mockDb.chain),
    update: vi.fn(() => mockDb.chain),
    delete: vi.fn(() => mockDb.chain),
    transaction: vi.fn((cb: any) => cb(mockDb.chain)),
  },
}));
vi.mock('@/lib/roles', () => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertTableRole: vi.fn().mockResolvedValue(undefined),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/server/realtime/publish', () => ({
  publishTableChange: vi.fn().mockResolvedValue(undefined),
  publishBaseChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/plugins/field-value', () => ({
  // Echo input so each test controls the parsed options shape.
  parseOptions: vi.fn((_type: string, raw: unknown) => raw),
  defaultOptions: vi.fn().mockReturnValue({}),
  normalizeCellValue: vi.fn(),
}));
vi.mock('@/server/expression', () => ({
  backfillExpressionField: vi.fn().mockResolvedValue(undefined),
}));

import { fieldRouter } from './field';
import { baseShare, field as fieldTable, view as viewTable } from '../../db/schema';

// Point the shared select chain at a value for the *next* await.
function resolveSelect(value: unknown) {
  (mockDb.chain as any).then = (onfulfilled: any) => Promise.resolve(value).then(onfulfilled);
}

// Sequential variant: each awaited select/returning resolves the next entry.
function queueSelects(results: unknown[][]) {
  let i = 0;
  (mockDb.chain as any).then = (onfulfilled: any) =>
    Promise.resolve(results[Math.min(i++, results.length - 1)] ?? []).then(onfulfilled);
}

const fieldRow = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  tableId: 't1',
  name: 'F',
  type: 'text',
  options: {},
  orderIndex: 0,
  createdAt: new Date(),
  ...over,
});

describe('fieldRouter — link target validation', () => {
  it('rejects a link field whose target table is in another base', async () => {
    resolveSelect([{ baseId: 'b-other' }]);
    await expect(
      fieldRouter
        .createCaller(session())
        .create({ tableId: 't1', name: 'L', type: 'link', options: { targetTableId: 'tx' } }),
    ).rejects.toThrow(/same base/);
  });

  it('rejects a link field without a target table', async () => {
    await expect(
      fieldRouter
        .createCaller(session())
        .create({ tableId: 't1', name: 'L', type: 'link', options: {} }),
    ).rejects.toThrow(/requires a target table/);
  });

  it('accepts a link field whose target table shares the base', async () => {
    resolveSelect([{ baseId: 'b1' }]);
    // Second select (insert().returning()) resolves via the same chain.
    const result = await fieldRouter
      .createCaller(session())
      .create({ tableId: 't1', name: 'L', type: 'link', options: { targetTableId: 'tx' } });
    expect(result).toBeDefined();
  });

  it('updateOptions re-validates the link target', async () => {
    const queue = [
      [fieldRow({ id: 'f-link', type: 'link' })], // existing field lookup
      [{ baseId: 'b-other' }], // target table lookup
    ];
    let i = 0;
    (mockDb.chain as any).then = (onfulfilled: any) =>
      Promise.resolve(queue[Math.min(i++, queue.length - 1)]).then(onfulfilled);

    await expect(
      fieldRouter
        .createCaller(session())
        .updateOptions({ id: 'f-link', options: { targetTableId: 'tx' } }),
    ).rejects.toThrow(/same base/);
  });
});

describe('fieldRouter — expression dependsOn constraints (ADR-0003)', () => {
  // extractDependsOn only matches {hex-uuid-like} refs — test ids must be hex.
  it('rejects an expression referencing an unknown field', async () => {
    resolveSelect([]);
    await expect(
      fieldRouter.createCaller(session()).create({
        tableId: 't1',
        name: 'E',
        type: 'expression',
        options: { expression: '{c0ffee}', dependsOn: [] },
      }),
    ).rejects.toThrow(/unknown field/);
  });

  it('rejects an expression referencing another expression field', async () => {
    resolveSelect([{ id: 'deadbeef', type: 'expression' }]);
    await expect(
      fieldRouter.createCaller(session()).create({
        tableId: 't1',
        name: 'E',
        type: 'expression',
        options: { expression: '{deadbeef}', dependsOn: [] },
      }),
    ).rejects.toThrow(/cannot reference expression/);
  });

  it('accepts an expression referencing a plain field and backfills post-commit', async () => {
    resolveSelect([{ id: 'abc123', type: 'number' }]);
    const { backfillExpressionField } = await import('@/server/expression');
    const result = await fieldRouter.createCaller(session()).create({
      tableId: 't1',
      name: 'E',
      type: 'expression',
      options: { expression: '{abc123}', dependsOn: [] },
    });
    expect(result).toBeDefined();
    expect(backfillExpressionField).toHaveBeenCalledWith('t1', result.id, '{abc123}', 'u1');
  });

  it('updateOptions re-derives and validates dependsOn', async () => {
    const queue = [
      [fieldRow({ id: 'f-expr', type: 'expression' })], // existing field lookup
      [], // sibling fields: referenced id unknown
    ];
    let i = 0;
    (mockDb.chain as any).then = (onfulfilled: any) =>
      Promise.resolve(queue[Math.min(i++, queue.length - 1)]).then(onfulfilled);

    await expect(
      fieldRouter
        .createCaller(session())
        .updateOptions({ id: 'f-expr', options: { expression: '{bad1d}', dependsOn: [] } }),
    ).rejects.toThrow(/unknown field/);
  });
});

describe('fieldRouter — delete dependency guard', () => {
  it('refuses to delete a field another expression depends on', async () => {
    const queue = [
      [fieldRow({ id: 'f-victim', type: 'number' })], // existing field lookup
      [
        fieldRow({ id: 'f-victim', type: 'number' }),
        fieldRow({ id: 'f-expr', type: 'expression', options: { dependsOn: ['f-victim'] } }),
      ], // siblings
    ];
    let i = 0;
    (mockDb.chain as any).then = (onfulfilled: any) =>
      Promise.resolve(queue[Math.min(i++, queue.length - 1)]).then(onfulfilled);

    await expect(fieldRouter.createCaller(session()).delete({ id: 'f-victim' })).rejects.toThrow(
      /delete or edit them first/,
    );
  });

  it('allows deleting an unreferenced field', async () => {
    const queue = [
      [fieldRow({ id: 'f-num', type: 'number' })],
      [fieldRow({ id: 'f-num', type: 'number' })],
    ];
    let i = 0;
    (mockDb.chain as any).then = (onfulfilled: any) =>
      Promise.resolve(queue[Math.min(i++, queue.length - 1)]).then(onfulfilled);

    const result = await fieldRouter.createCaller(session()).delete({ id: 'f-num' });
    expect(result.ok).toBe(true);
  });
});

describe('fieldRouter — updateOptions concurrent delete (review L-1/N5)', () => {
  it('rejects NOT_FOUND when the field vanished before the update committed', async () => {
    queueSelects([
      [fieldRow({ id: 'f-gone', type: 'text' })], // existing-field lookup (stale)
      [], // update().returning(): a concurrent field.delete took the row
    ]);
    // Previously the empty returning fell through a non-null assertion and
    // row.tableId threw a TypeError after commit (500); now a clean NOT_FOUND.
    await expect(
      fieldRouter.createCaller(session()).updateOptions({ id: 'f-gone', options: {} }),
    ).rejects.toThrow('Field not found');
  });
});

describe('fieldRouter — link retarget guard (review M3)', () => {
  it('rejects retargeting a link field that already stores values', async () => {
    queueSelects([
      [fieldRow({ id: 'f-link', type: 'link', options: { targetTableId: 't-old' } })], // existing
      [{ baseId: 'b1' }], // new target table lives in the same base
      [{ id: 'c1' }], // …but a cell already stores a value for this field
    ]);
    await expect(
      fieldRouter
        .createCaller(session())
        .updateOptions({ id: 'f-link', options: { targetTableId: 't-new' } }),
    ).rejects.toThrow(/Cannot retarget a link field/);
  });

  it('allows retargeting a link field with no stored values', async () => {
    queueSelects([
      [fieldRow({ id: 'f-link', type: 'link', options: { targetTableId: 't-old' } })],
      [{ baseId: 'b1' }], // new target in the same base
      [], // no cells for this field
      [fieldRow({ id: 'f-link', type: 'link', options: { targetTableId: 't-new' } })], // update
    ]);
    const result = await fieldRouter
      .createCaller(session())
      .updateOptions({ id: 'f-link', options: { targetTableId: 't-new' } });
    expect(result).toBeDefined();
  });

  it('allows re-saving the same link target without a cell scan', async () => {
    queueSelects([
      [fieldRow({ id: 'f-link', type: 'link', options: { targetTableId: 't-same' } })],
      [{ baseId: 'b1' }],
      // Poisoned slot: a buggy cell scan would read this as "values stored"
      // and reject; the correct path consumes it as update().returning().
      [{ id: 'c1' }],
    ]);
    const result = await fieldRouter
      .createCaller(session())
      .updateOptions({ id: 'f-link', options: { targetTableId: 't-same' } });
    expect(result).toBeDefined();
  });
});

describe('fieldRouter — delete view-options lock (review L-2)', () => {
  // Flattens a drizzle `sql` fragment into literal text + bound params.
  function flattenSql(fragment: any): { text: string; params: unknown[] } {
    const text: string[] = [];
    const params: unknown[] = [];
    for (const chunk of fragment?.queryChunks ?? []) {
      if (chunk && typeof chunk === 'object' && Array.isArray(chunk.value)) {
        text.push(chunk.value.join(''));
      } else if (chunk && typeof chunk === 'object' && Array.isArray(chunk.queryChunks)) {
        const nested = flattenSql(chunk);
        text.push(nested.text);
        params.push(...nested.params);
      } else {
        params.push(chunk);
      }
    }
    return { text: text.join(''), params };
  }

  it('locks the table against view.updateOptions writers before scanning views', async () => {
    queueSelects([
      [fieldRow({ id: 'f-del', type: 'text' })], // existing field lookup
      [fieldRow({ id: 'f-del', type: 'text' })], // siblings — no dependents
      [], // views of the table (none reference the field)
    ]);
    (mockDb.chain.execute as any).mockClear();
    (mockDb.chain.from as any).mockClear();
    await fieldRouter.createCaller(session()).delete({ id: 'f-del' });

    // Exactly one lock statement, in the 'view-options:' namespace (disjoint
    // from cell.ts's per-cell locks), parameterized by the field's tableId.
    expect((mockDb.chain.execute as any).mock.calls).toHaveLength(1);
    const { text, params } = flattenSql((mockDb.chain.execute as any).mock.calls[0][0]);
    expect(text).toContain('pg_advisory_xact_lock');
    expect(text).toContain("hashtext('view-options:'");
    expect(params).toContain('t1');
    // Lock acquired BEFORE the in-transaction view scan (first from(view)).
    const viewScan = (mockDb.chain.from as any).mock.calls.findIndex(
      (c: any[]) => c[0] === viewTable,
    );
    expect(viewScan).toBeGreaterThanOrEqual(0);
    expect((mockDb.chain.execute as any).mock.invocationCallOrder[0]).toBeLessThan(
      (mockDb.chain.from as any).mock.invocationCallOrder[viewScan],
    );
  });
});

describe('fieldRouter — delete cleans view options and invalidates shares (review M-2)', () => {
  beforeEach(() => {
    (mockDb.chain.update as any).mockClear();
    (mockDb.chain.delete as any).mockClear();
    (mockDb.chain.set as any).mockClear();
  });

  it('invalidates shares pinned to views whose filter referenced the deleted field', async () => {
    queueSelects([
      [fieldRow({ id: 'f-del', type: 'text' })], // existing field lookup
      [fieldRow({ id: 'f-del', type: 'text' })], // siblings — no expression dependents
      [
        {
          id: 'v1',
          tableId: 't1',
          // Both the filter condition and the hidden-field entry reference f-del.
          options: {
            filter: {
              op: 'and',
              conditions: [{ fieldId: 'f-del', operator: 'equals', operand: 'x' }],
            },
            hiddenFields: ['f-del'],
          },
        },
      ],
    ]);
    const result = await fieldRouter.createCaller(session()).delete({ id: 'f-del' });
    expect(result.ok).toBe(true);
    // The whole filter collapsed and hiddenFields emptied → pruned options…
    expect(mockDb.chain.update).toHaveBeenCalledWith(viewTable);
    expect((mockDb.chain.set as any).mock.calls[0]![0]).toEqual({ options: {} });
    // …and the share bound to v1 is revoked before the field row goes.
    const deleted = (mockDb.chain.delete as any).mock.calls.map((c: any[]) => c[0]);
    expect(deleted).toEqual([baseShare, fieldTable]);
  });

  it('prunes non-filter references without revoking shares', async () => {
    queueSelects([
      [fieldRow({ id: 'f-del', type: 'text' })],
      [fieldRow({ id: 'f-del', type: 'text' })],
      [
        {
          id: 'v2',
          tableId: 't1',
          // Sort/group/hidden reference the field, the filter does not.
          options: {
            sort: [
              { fieldId: 'f-del', direction: 'asc' },
              { fieldId: 'f-keep', direction: 'desc' },
            ],
            group: [{ fieldId: 'f-del' }],
            hiddenFields: ['f-del'],
          },
        },
      ],
    ]);
    const result = await fieldRouter.createCaller(session()).delete({ id: 'f-del' });
    expect(result.ok).toBe(true);
    expect((mockDb.chain.set as any).mock.calls[0]![0]).toEqual({
      options: { sort: [{ fieldId: 'f-keep', direction: 'desc' }] },
    });
    // Only the field row is deleted — no share revocation.
    expect((mockDb.chain.delete as any).mock.calls.map((c: any[]) => c[0])).toEqual([fieldTable]);
  });

  it('does not rewrite views that never referenced the field', async () => {
    queueSelects([
      [fieldRow({ id: 'f-del', type: 'text' })],
      [fieldRow({ id: 'f-del', type: 'text' })],
      [{ id: 'v3', tableId: 't1', options: { hiddenFields: ['f-other'] } }],
    ]);
    const result = await fieldRouter.createCaller(session()).delete({ id: 'f-del' });
    expect(result.ok).toBe(true);
    expect(mockDb.chain.update).not.toHaveBeenCalled();
    expect((mockDb.chain.delete as any).mock.calls.map((c: any[]) => c[0])).toEqual([fieldTable]);
  });
});
