import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TRPCError } from '@trpc/server';
import type { SQL } from 'drizzle-orm';

import { compileFilter, compileSort, applyGroup } from './view-query';
import type { FilterNode } from './view-ast';

const dialect = new PgDialect();

// Render a drizzle SQL fragment the way the record query would.
function render(sql: SQL | null): { text: string; params: unknown[] } {
  expect(sql).not.toBeNull();
  const q = dialect.sqlToQuery(sql!);
  return { text: q.sql, params: q.params as unknown[] };
}

const SCALAR = `c.value #>> '{}'`;
const NUMERIC = `(CASE WHEN jsonb_typeof(c.value) = 'object' THEN NULL ELSE (c.value #>> '{}')::numeric END)`;

function fields(entries: Array<[string, string]>) {
  return new Map(entries.map(([id, type]) => [id, { type, options: {} }]));
}

describe('compileFilter — operators × field types', () => {
  it('returns null for undefined filter', () => {
    expect(compileFilter(undefined, new Map())).toBeNull();
  });

  it('equals on text compares the jsonb scalar as text', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'equals', operand: 'hello' },
      fields([['f1', 'text']]),
    );
    const { text, params } = render(sql);
    expect(text).toContain(
      `EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = $1 AND ${SCALAR} = $2)`,
    );
    expect(params).toEqual(['f1', 'hello']);
  });

  it('equals on number casts to numeric', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'equals', operand: 42 },
      fields([['f1', 'number']]),
    );
    const { text, params } = render(sql);
    expect(text).toContain(`${NUMERIC} = $2`);
    expect(params).toEqual(['f1', 42]);
  });

  it('ne on number uses a numeric inequality', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'ne', operand: 7 },
      fields([['f1', 'number']]),
    );
    const { text } = render(sql);
    expect(text).toContain(`${NUMERIC} <> $2`);
  });

  it('gte bounds with numeric >=', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'gte', operand: 10 },
      fields([['f1', 'number']]),
    );
    const { text } = render(sql);
    expect(text).toContain(`${NUMERIC} >= $2`);
  });

  it('contains wraps in %…% ILIKE with wildcard escaping', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'contains', operand: '100%' },
      fields([['f1', 'text']]),
    );
    const { text, params } = render(sql);
    expect(text).toContain(`${SCALAR} ILIKE $2 ESCAPE '\\'`);
    // % inside the operand must be escaped so it cannot widen the match.
    expect(params).toEqual(['f1', '%100\\%%']);
  });

  it('in-style OR group of equals compiles to parenthesized OR', () => {
    const sql = compileFilter(
      {
        op: 'or',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'a' },
          { fieldId: 'f1', operator: 'equals', operand: 'b' },
        ],
      },
      fields([['f1', 'text']]),
    );
    const { text } = render(sql);
    expect(text).toMatch(/^\(EXISTS .* OR EXISTS .*\)\)$/);
    // The group keyword is OR, never AND, at the join level.
    expect(text).toContain(') OR EXISTS (');
  });

  it('empty / notEmpty compile to EXISTS probes without operand', () => {
    const empty = render(
      compileFilter({ fieldId: 'f1', operator: 'empty' }, fields([['f1', 'text']])),
    );
    expect(empty.text).toContain(
      'NOT EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = $1)',
    );
    const notEmpty = render(
      compileFilter({ fieldId: 'f1', operator: 'notEmpty' }, fields([['f1', 'text']])),
    );
    expect(notEmpty.text).toContain(
      'EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = $1)',
    );
  });

  it('is on boolean casts the scalar', () => {
    const sql = compileFilter(
      { fieldId: 'f1', operator: 'is', operand: 'true' },
      fields([['f1', 'boolean']]),
    );
    const { text, params } = render(sql);
    expect(text).toContain(`(${SCALAR})::boolean = $2`);
    expect(params).toEqual(['f1', true]);
  });

  it('returns null for unknown field', () => {
    const filter = { fieldId: 'unknown', operator: 'equals', operand: 'x' };
    expect(compileFilter(filter, new Map())).toBeNull();
  });

  it('returns null for an unsupported operator (write-time validation rejects these)', () => {
    const filter = { fieldId: 'f1', operator: 'regex' as const, operand: 'x' };
    expect(compileFilter(filter, fields([['f1', 'text']]))).toBeNull();
  });
});

describe('compileFilter — depth guard', () => {
  function nested(depth: number): FilterNode {
    let node: FilterNode = { fieldId: 'f1', operator: 'equals', operand: 'x' };
    for (let i = 0; i < depth; i++) {
      node = { op: 'and', conditions: [node] };
    }
    return node;
  }

  it('compiles a tree within the depth limit', () => {
    expect(() => compileFilter(nested(9), fields([['f1', 'text']]))).not.toThrow();
  });

  it('throws BAD_REQUEST instead of overflowing on a too-deep tree', () => {
    const deep = nested(50);
    let err: unknown;
    try {
      compileFilter(deep, fields([['f1', 'text']]));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe('BAD_REQUEST');
  });
});

describe('compileSort', () => {
  it('returns null for undefined sort', () => {
    expect(compileSort(undefined, new Map())).toBeNull();
  });

  it('sorts text fields by the scalar with direction and NULLS LAST', () => {
    const sql = compileSort([{ fieldId: 'f1', direction: 'asc' }], fields([['f1', 'text']]));
    const { text, params } = render(sql);
    expect(text).toContain(
      `(SELECT ${SCALAR} FROM cell c WHERE c.record_id = record.id AND c.field_id = $1) ASC NULLS LAST`,
    );
    expect(params).toEqual(['f1']);
  });

  it('sorts number fields numerically and honors desc', () => {
    const sql = compileSort([{ fieldId: 'f1', direction: 'desc' }], fields([['f1', 'number']]));
    const { text } = render(sql);
    expect(text).toContain(
      `(SELECT ${NUMERIC} FROM cell c WHERE c.record_id = record.id AND c.field_id = $1) DESC NULLS LAST`,
    );
  });

  it('sorts boolean fields with a boolean cast', () => {
    const sql = compileSort([{ fieldId: 'f1', direction: 'asc' }], fields([['f1', 'boolean']]));
    const { text } = render(sql);
    expect(text).toContain(`(${SCALAR})::boolean`);
  });
});

describe('applyGroup', () => {
  it('returns single group with null key when no group spec', () => {
    const records = [
      { id: 'r1', cells: {} },
      { id: 'r2', cells: {} },
    ];
    expect(applyGroup(records, undefined)).toEqual([{ key: null, records }]);
  });

  it('groups records by field value', () => {
    const records = [
      { id: 'r1', cells: { f1: 'a' } },
      { id: 'r2', cells: { f1: 'b' } },
      { id: 'r3', cells: { f1: 'a' } },
    ];
    const groups = applyGroup(records, [{ fieldId: 'f1' }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe('a');
    expect(groups[0]!.records).toHaveLength(2);
    expect(groups[1]!.key).toBe('b');
    expect(groups[1]!.records).toHaveLength(1);
  });
});
