import { describe, expect, it } from 'vitest';
import { compileFilter, compileSort, applyGroup } from './view-query';

describe('compileFilter', () => {
  it('returns null for undefined filter', () => {
    expect(compileFilter(undefined, new Map())).toBeNull();
  });

  it('compiles a simple condition', () => {
    const fields = new Map([['f1', { type: 'text', options: {} }]]);
    const filter = { fieldId: 'f1', operator: 'equals', operand: 'hello' };
    const sql = compileFilter(filter, fields);
    expect(sql).not.toBeNull();
    expect(sql!.toSQL()).toContain('hello');
  });

  it('returns null for unknown field', () => {
    const filter = { fieldId: 'unknown', operator: 'equals', operand: 'x' };
    expect(compileFilter(filter, new Map())).toBeNull();
  });
});

describe('compileSort', () => {
  it('returns null for undefined sort', () => {
    expect(compileSort(undefined, new Map())).toBeNull();
  });

  it('compiles a sort clause', () => {
    const fields = new Map([['f1', { type: 'text', options: {} }]]);
    const sql = compileSort([{ fieldId: 'f1', direction: 'asc' }], fields);
    expect(sql).not.toBeNull();
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
