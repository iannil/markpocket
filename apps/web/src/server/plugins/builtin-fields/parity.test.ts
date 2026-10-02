import { describe, expect, it } from 'vitest';

import { builtinFieldTypes } from './index';

const byType = Object.fromEntries(builtinFieldTypes.map((c) => [c.type, c]));

describe('builtin field types — normalizeCellValue parity', () => {
  it('text: empty on null/empty-string, value otherwise', () => {
    expect(byType['text'].normalizeCellValue({}, null)).toEqual({ empty: true });
    expect(byType['text'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['text'].normalizeCellValue({}, 'hi')).toEqual({ value: 'hi' });
  });
  it('number: empty/error/value', () => {
    expect(byType['number'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['number'].normalizeCellValue({}, 'abc')).toEqual({ error: 'Invalid number' });
    expect(byType['number'].normalizeCellValue({}, '3.5')).toEqual({ value: 3.5 });
    expect(byType['number'].normalizeCellValue({}, 4)).toEqual({ value: 4 });
  });
  it('boolean: bool/string/error', () => {
    expect(byType['boolean'].normalizeCellValue({}, null)).toEqual({ empty: true });
    expect(byType['boolean'].normalizeCellValue({}, true)).toEqual({ value: true });
    expect(byType['boolean'].normalizeCellValue({}, 'false')).toEqual({ value: false });
    expect(byType['boolean'].normalizeCellValue({}, 'x')).toEqual({ error: 'Invalid boolean' });
  });
  it('date: parse-based', () => {
    expect(byType['date'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['date'].normalizeCellValue({}, 'not-a-date')).toEqual({ error: 'Invalid date' });
    expect(byType['date'].normalizeCellValue({}, '2026-07-10')).toEqual({ value: '2026-07-10' });
  });
  it('single-select: membership by option id', () => {
    const opts = { choices: [{ id: 'o1', name: 'A', color: 'red' }] };
    expect(byType['single-select'].normalizeCellValue(opts, '')).toEqual({ empty: true });
    expect(byType['single-select'].normalizeCellValue(opts, 'o1')).toEqual({ value: 'o1' });
    expect(byType['single-select'].normalizeCellValue(opts, 'zz')).toEqual({
      error: 'Unknown select option',
    });
  });
  it('expression: always error (computed)', () => {
    expect(byType['expression'].normalizeCellValue({}, '1')).toEqual({
      error: 'Expression fields are computed, not user-editable',
    });
  });
  it('multi-select: array membership', () => {
    const opts = { choices: [{ id: 'o1', name: 'A', color: 'red' }] };
    expect(byType['multi-select'].normalizeCellValue(opts, [])).toEqual({ empty: true });
    expect(byType['multi-select'].normalizeCellValue(opts, ['o1'])).toEqual({ value: ['o1'] });
    expect(byType['multi-select'].normalizeCellValue(opts, ['zz'])).toEqual({
      error: 'Unknown select option',
    });
  });
  it('user: string id', () => {
    expect(byType['user'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['user'].normalizeCellValue({}, 'u1')).toEqual({ value: 'u1' });
  });
  it('link: id array', () => {
    expect(byType['link'].normalizeCellValue({}, [])).toEqual({ empty: true });
    expect(byType['link'].normalizeCellValue({}, ['r1', 'r2'])).toEqual({ value: ['r1', 'r2'] });
  });
  it('attachment: id array', () => {
    expect(byType['attachment'].normalizeCellValue({}, [])).toEqual({ empty: true });
    expect(byType['attachment'].normalizeCellValue({}, ['a1'])).toEqual({ value: ['a1'] });
  });
});

describe('builtin field types — defaultOptions parity', () => {
  it('matches known defaults', () => {
    expect(byType['number'].defaultOptions()).toEqual({ precision: 0 });
    expect(byType['date'].defaultOptions()).toEqual({ includeTime: false });
    expect(byType['single-select'].defaultOptions()).toEqual({ choices: [] });
    expect(byType['expression'].defaultOptions()).toEqual({ expression: '', dependsOn: [] });
    expect(byType['link'].defaultOptions()).toEqual({ targetTableId: '' });
    expect(byType['text'].defaultOptions()).toEqual({});
  });
});

describe('builtin field types — id-array normalization', () => {
  it('link/attachment dedupe repeated ids and lift scalars', () => {
    for (const type of ['link', 'attachment']) {
      expect(byType[type].normalizeCellValue({}, 'r1')).toEqual({ value: ['r1'] });
      expect(byType[type].normalizeCellValue({}, ['r1', 'r1', 'r2'])).toEqual({
        value: ['r1', 'r2'],
      });
    }
  });
  it('multi-select dedupes too', () => {
    const opts = { choices: [{ id: 'o1', name: 'A', color: 'red' }] };
    expect(byType['multi-select'].normalizeCellValue(opts, ['o1', 'o1'])).toEqual({
      value: ['o1'],
    });
  });
});

describe('builtin field types — expression option bounds', () => {
  it('accepts expressions up to 10,000 chars', () => {
    expect(() =>
      byType['expression'].optionsSchema.parse({ expression: 'x'.repeat(10_000), dependsOn: [] }),
    ).not.toThrow();
  });
  it('rejects longer expressions', () => {
    expect(() =>
      byType['expression'].optionsSchema.parse({ expression: 'x'.repeat(10_001), dependsOn: [] }),
    ).toThrow();
  });
});

describe('builtin field types — option size bounds', () => {
  const choice = (id = 'o1', name = 'A', color = 'red') => ({ id, name, color });

  it('single-select accepts up to 200 choices', () => {
    const choices = Array.from({ length: 200 }, (_, i) => choice(`o${i}`, `N${i}`));
    expect(() => byType['single-select'].optionsSchema.parse({ choices })).not.toThrow();
  });
  it('single-select rejects more than 200 choices', () => {
    const choices = Array.from({ length: 201 }, (_, i) => choice(`o${i}`, `N${i}`));
    expect(() => byType['single-select'].optionsSchema.parse({ choices })).toThrow();
  });
  it('multi-select enforces the same choice bounds', () => {
    const choices = Array.from({ length: 201 }, (_, i) => choice(`o${i}`, `N${i}`));
    expect(() => byType['multi-select'].optionsSchema.parse({ choices })).toThrow();
  });
  it('rejects choice names over 100 chars', () => {
    expect(() =>
      byType['single-select'].optionsSchema.parse({ choices: [choice('o1', 'n'.repeat(101))] }),
    ).toThrow();
  });
  it('rejects choice ids over 64 chars', () => {
    expect(() =>
      byType['single-select'].optionsSchema.parse({ choices: [choice('i'.repeat(65))] }),
    ).toThrow();
  });
  it('rejects choice colors over 32 chars', () => {
    expect(() =>
      byType['multi-select'].optionsSchema.parse({ choices: [choice('o1', 'A', 'c'.repeat(33))] }),
    ).toThrow();
  });
  it('rejects link targetTableId over 64 chars', () => {
    expect(() => byType['link'].optionsSchema.parse({ targetTableId: 't'.repeat(65) })).toThrow();
  });
  it('rejects oversized expression dependsOn arrays', () => {
    expect(() =>
      byType['expression'].optionsSchema.parse({
        expression: '1',
        dependsOn: Array.from({ length: 501 }, (_, i) => `f${i}`),
      }),
    ).toThrow();
  });
});

describe('builtin field types — link validateCellValue', () => {
  it('passes when every id exists in the target table', async () => {
    const ctx = {
      existingRecordIds: async (ids: string[]) => new Set(ids),
      existingAttachmentIds: async () => new Set<string>(),
    };
    const err = await byType['link'].validateCellValue!({ targetTableId: 't2' }, ['r1', 'r2'], ctx);
    expect(err).toBeNull();
  });
  it('names the missing record ids', async () => {
    const ctx = {
      existingRecordIds: async (ids: string[]) => new Set(ids.filter((id) => id !== 'r-gone')),
      existingAttachmentIds: async () => new Set<string>(),
    };
    const err = await byType['link'].validateCellValue!(
      { targetTableId: 't2' },
      ['r1', 'r-gone'],
      ctx,
    );
    expect(err).toMatch(/r-gone/);
  });
  it('fails fast without a target table', async () => {
    const ctx = {
      existingRecordIds: async () => new Set<string>(),
      existingAttachmentIds: async () => new Set<string>(),
    };
    const err = await byType['link'].validateCellValue!({}, ['r1'], ctx);
    expect(err).toMatch(/no target table/);
  });
});

describe('builtin field types — attachment validateCellValue (L-2)', () => {
  // The host resolver scopes to the field's own base: it only ever returns ids
  // that exist as attachments OF THAT BASE, so "cross-base" and "nonexistent"
  // are indistinguishable from the contribution's point of view — both come
  // back missing.
  const baseCtx = (sameBaseIds: string[]) => ({
    existingRecordIds: async () => new Set<string>(),
    existingAttachmentIds: async (ids: string[]) =>
      new Set(ids.filter((id) => sameBaseIds.includes(id))),
  });

  it('passes when every id exists in the same base', async () => {
    const ctx = baseCtx(['att-1', 'att-2']);
    const err = await byType['attachment'].validateCellValue!({}, ['att-1', 'att-2'], ctx);
    expect(err).toBeNull();
  });
  it('rejects cross-base or nonexistent ids and names them', async () => {
    const ctx = baseCtx(['att-1']);
    const err = await byType['attachment'].validateCellValue!(
      {},
      ['att-1', 'att-other-base', 'att-missing'],
      ctx,
    );
    expect(err).toMatch(/Unknown attachment id/);
    expect(err).toMatch(/att-other-base/);
    expect(err).toMatch(/att-missing/);
  });
  it('skips the batched query for an empty value', async () => {
    let queried = false;
    const ctx = {
      existingRecordIds: async () => new Set<string>(),
      existingAttachmentIds: async () => {
        queried = true;
        return new Set<string>();
      },
    };
    // Empty cells never reach validateCellValue on the write path (cell.ts),
    // but the contribution must stay safe if called directly anyway.
    const err = await byType['attachment'].validateCellValue!({}, [], ctx);
    expect(err).toBeNull();
    expect(queried).toBe(false);
  });
});

describe('builtin field types — optionsSchema parity', () => {
  it('number rejects out-of-range precision', () => {
    expect(() => byType['number'].optionsSchema.parse({ precision: 99 })).toThrow();
  });
  it('number accepts empty options', () => {
    expect(byType['number'].optionsSchema.parse({})).toEqual({});
  });
  it('all 10 builtin types present', () => {
    expect(builtinFieldTypes).toHaveLength(10);
  });
});
