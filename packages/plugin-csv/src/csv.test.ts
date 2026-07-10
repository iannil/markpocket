import { describe, expect, it } from 'vitest';

import { csvEscape, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and quotes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });
  it('drops fully-empty rows', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvEscape', () => {
  it('quotes fields containing comma/quote/newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he "q"')).toBe('"he ""q"""');
    expect(csvEscape('plain')).toBe('plain');
  });
});
