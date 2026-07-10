import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));

import { defaultOptions, normalizeCellValue, parseOptions } from './field-value';

describe('field-value dispatch', () => {
  it('normalizeCellValue dispatches to the registered type', () => {
    expect(normalizeCellValue('number', {}, '3')).toEqual({ value: 3 });
    expect(normalizeCellValue('text', {}, '')).toEqual({ empty: true });
  });
  it('parseOptions validates via the type schema', () => {
    expect(parseOptions('number', { precision: 2 })).toEqual({ precision: 2 });
    expect(() => parseOptions('number', { precision: 99 })).toThrow();
  });
  it('defaultOptions returns the type default', () => {
    expect(defaultOptions('date')).toEqual({ includeTime: false });
  });
  it('unknown type throws with a helpful message', () => {
    expect(() => normalizeCellValue('nope', {}, 'x')).toThrow(/Unknown field type "nope"/);
  });
});
