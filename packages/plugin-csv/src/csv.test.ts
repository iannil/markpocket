import { describe, expect, it } from 'vitest';

import { csvEscape, csvUnguard, parseCsv, parseCsvBoolean } from './csv';

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
  it('strips a leading UTF-8 BOM (Excel/Windows exports)', () => {
    expect(parseCsv('\uFEFFname,value\na,1')).toEqual([
      ['name', 'value'],
      ['a', '1'],
    ]);
  });
});

describe('csvEscape', () => {
  it('quotes fields containing comma/quote/newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he "q"')).toBe('"he ""q"""');
    expect(csvEscape('plain')).toBe('plain');
  });
  it('neutralizes formula prefixes (CSV injection)', () => {
    // Quoting also applies when the guarded value contains quotes.
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvEscape('+1|cmd')).toBe("'+1|cmd");
    expect(csvEscape('@SUM(A1)').startsWith("'@SUM")).toBe(true);
  });
  it('keeps plain numbers untouched for round-trip', () => {
    expect(csvEscape('42')).toBe('42');
    expect(csvEscape('3.14')).toBe('3.14');
  });
});

describe('csvUnguard', () => {
  it('reverses the formula-guard apostrophe', () => {
    expect(csvUnguard("'=1+1")).toBe('=1+1');
    expect(csvUnguard('plain')).toBe('plain');
  });
  it('round-trips guarded values', () => {
    expect(csvUnguard(csvEscape('=1+1'))).toBe('=1+1');
  });
});

describe('parseCsvBoolean', () => {
  it('accepts common true/false literals case-insensitively', () => {
    expect(parseCsvBoolean('TRUE')).toBe(true);
    expect(parseCsvBoolean('yes')).toBe(true);
    expect(parseCsvBoolean('On')).toBe(true);
    expect(parseCsvBoolean('1')).toBe(true);
    expect(parseCsvBoolean('False')).toBe(false);
    expect(parseCsvBoolean('no')).toBe(false);
    expect(parseCsvBoolean('0')).toBe(false);
  });
  it('returns null for unrecognized values', () => {
    expect(parseCsvBoolean('maybe')).toBeNull();
    expect(parseCsvBoolean('')).toBeNull();
  });
});
