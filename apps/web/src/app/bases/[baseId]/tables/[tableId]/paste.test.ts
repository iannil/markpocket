import { expect, it } from 'vitest';
import { parseTsv, planPaste } from './paste';

it('keeps quoted newlines and empty trailing cells', () => {
  expect(parseTsv('"a\nb"\t2\r\nc\t\r\n')).toEqual([
    ['a\nb', '2'],
    ['c', ''],
  ]);
  expect(parseTsv('"a""b"\tx')).toEqual([['a"b', 'x']]);
  expect(() => parseTsv('"unfinished')).toThrow();
});

it('rejects malformed quote placement and text after a closing quote', () => {
  expect(() => parseTsv('a"b')).toThrow();
  expect(() => parseTsv('"a"b')).toThrow();
  expect(() => parseTsv('"a" "b"')).toThrow();
});

it('enforces row, cell, and UTF-8 byte limits', () => {
  expect(() => parseTsv(Array.from({ length: 101 }, () => 'x').join('\n'))).toThrow();
  expect(parseTsv(Array.from({ length: 100 }, () => 'x').join('\n'))).toHaveLength(100);
  expect(() => parseTsv(Array.from({ length: 501 }, () => 'x').join('\t'))).toThrow();
  expect(parseTsv(Array.from({ length: 500 }, () => 'x').join('\t'))[0]).toHaveLength(500);
  expect(() => parseTsv('🙂'.repeat(262145))).toThrow();
});

it('cannot append through a filtered view or spill into hidden columns', () => {
  expect(() => planPaste([['a'], ['b']], ['r'], ['f'], { row: 0, column: 0 }, false)).toThrow();
  expect(() => planPaste([['a', 'b']], ['r'], ['f'], { row: 0, column: 0 }, true)).toThrow();
  expect(
    planPaste([['a'], ['b']], ['r'], ['f'], { row: 0, column: 0 }, true)[1]?.recordId,
  ).toBeUndefined();
});

it('rejects nonrectangular and over-limit plans', () => {
  expect(() =>
    planPaste([['a'], ['b', 'c']], ['r1', 'r2'], ['f1', 'f2'], { row: 0, column: 0 }, false),
  ).toThrow();
  expect(() =>
    planPaste(
      Array.from({ length: 101 }, () => ['x']),
      [],
      ['f'],
      { row: 0, column: 0 },
      true,
    ),
  ).toThrow();
  expect(() =>
    planPaste(
      [Array.from({ length: 501 }, () => 'x')],
      [],
      Array.from({ length: 501 }, (_, i) => `f${i}`),
      { row: 0, column: 0 },
      true,
    ),
  ).toThrow();
});

it('preserves empty cells, CRLF inside quotes, and intentional empty rows', () => {
  expect(parseTsv('')).toEqual([['']]);
  expect(parseTsv('\t\n')).toEqual([['', '']]);
  expect(parseTsv('a\n\n')).toEqual([['a'], ['']]);
  expect(parseTsv('"a\r\nb"\tc')).toEqual([['a\r\nb', 'c']]);
  expect(parseTsv('🙂'.repeat(262144))).toEqual([['🙂'.repeat(262144)]]);
  expect(parseTsv(Array(100).fill('x').join('\n') + '\n')).toHaveLength(100);
  expect(parseTsv(Array(500).fill('x').join('\t') + '\n')[0]).toHaveLength(500);
});

it('maps offsets and appended rows without converting cell text', () => {
  expect(
    planPaste(
      [
        ['  a ', ''],
        ['b', 'c'],
      ],
      ['r0', 'r1'],
      ['f0', 'f1', 'f2'],
      { row: 1, column: 1 },
      true,
    ),
  ).toEqual([
    {
      recordId: 'r1',
      values: [
        { fieldId: 'f1', text: '  a ' },
        { fieldId: 'f2', text: '' },
      ],
    },
    {
      recordId: undefined,
      values: [
        { fieldId: 'f1', text: 'b' },
        { fieldId: 'f2', text: 'c' },
      ],
    },
  ]);
});

it('rejects empty matrices and invalid anchors', () => {
  for (const matrix of [[], [[]]])
    expect(() => planPaste(matrix, [], ['f'], { row: 0, column: 0 }, true)).toThrow();
  for (const anchor of [
    { row: -1, column: 0 },
    { row: 0, column: -1 },
    { row: 0.5, column: 0 },
    { row: NaN, column: 0 },
    { row: 0, column: Infinity },
    { row: 2, column: 0 },
  ]) {
    expect(() => planPaste([['x']], ['r'], ['f'], anchor, true)).toThrow();
  }
});
