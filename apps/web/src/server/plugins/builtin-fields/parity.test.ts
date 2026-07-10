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
