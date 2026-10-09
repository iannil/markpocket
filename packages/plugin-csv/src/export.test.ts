import { describe, expect, it } from 'vitest';
import type { CoreFieldTypes } from '@markpocket/plugin-sdk';
import { collectCsv, CsvBudgetError } from './export';

const ft: CoreFieldTypes = {
  FieldType: { Text: 'text' },
  formatNumberToString: String,
  parseStringToNumber: Number,
  normalizeCellValue: () => ({ empty: true }),
};
const fields = [{ id: 'f', name: 'Name', type: 'text', options: {} }];
const budget = () => ({ remainingBytes: 8 * 1024 * 1024 });
function source(n: number) {
  return async (offset: number, limit: number) =>
    Array.from({ length: Math.max(0, Math.min(limit, n - offset)) }, (_, i) => ({
      cells: { f: `row-${offset + i}` },
    }));
}

describe('complete CSV', () => {
  it.each([0, 10001, 100000])('exports all %i records', async (n) => {
    const result = await collectCsv(fields, source(n), ft, budget());
    expect(result.exported).toBe(n);
    expect(result.csv.split('\n')).toHaveLength(n + 1);
    if (n) expect(result.csv.endsWith(`row-${n - 1}`)).toBe(true);
  });
  it('rejects 100001 records without returning a file', async () => {
    await expect(collectCsv(fields, source(100001), ft, budget())).rejects.toBeInstanceOf(
      CsvBudgetError,
    );
  });
  it('counts UTF-8 bytes including separators and header', async () => {
    const read = async (offset: number) => (offset ? [] : [{ cells: { f: '中' } }]);
    const exact = { remainingBytes: Buffer.byteLength('Name\n中') };
    expect((await collectCsv(fields, read, ft, exact)).csv).toBe('Name\n中');
    expect(exact.remainingBytes).toBe(0);
    await expect(collectCsv(fields, read, ft, { remainingBytes: 7 })).rejects.toBeInstanceOf(
      CsvBudgetError,
    );
  });
  it('shares the byte budget across tables', async () => {
    const shared = { remainingBytes: 7 };
    await collectCsv(fields, source(0), ft, shared);
    await expect(collectCsv(fields, source(0), ft, shared)).rejects.toBeInstanceOf(CsvBudgetError);
  });
  it('retains formula guarding and quote escaping', async () => {
    const read = async (offset: number) =>
      offset ? [] : [{ cells: { f: '=1+1' } }, { cells: { f: 'a,"b"\nc' } }];
    const result = await collectCsv(fields, read, ft, budget());
    expect(result.csv).toBe('Name\n\'=1+1\n"a,""b""\nc"');
  });
});
