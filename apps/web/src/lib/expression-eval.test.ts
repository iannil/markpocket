import { describe, expect, it } from 'vitest';
import { evaluateExpression, extractDependsOn } from './expression-eval';

describe('evaluateExpression', () => {
  it('returns empty for empty input', () => {
    expect(evaluateExpression('', new Map())).toEqual({ empty: true });
    expect(evaluateExpression('   ', new Map())).toEqual({ empty: true });
  });

  it('evaluates simple arithmetic', () => {
    const values = new Map([
      ['f1', 3],
      ['f2', 5],
    ]);
    const expr = '{f1} * {f2} + 2';
    expect(evaluateExpression(expr, values)).toEqual({ value: 17 });
  });

  it('returns empty when a dependency is missing', () => {
    const values = new Map([['f1', 3]]);
    expect(evaluateExpression('{f1} * {f2}', values)).toEqual({ empty: true });
  });

  it('returns error for non-numeric dependency', () => {
    const values = new Map([['f1', 'abc']]);
    expect(evaluateExpression('{f1} + 1', values)).toEqual({ error: 'Non-numeric dependency' });
  });

  it('returns error for division by zero', () => {
    const values = new Map([
      ['f1', 5],
      ['f2', 0],
    ]);
    expect(evaluateExpression('{f1} / {f2}', values)).toEqual({ error: 'Division by zero' });
  });

  it('handles dependencies whose String() uses exponent notation', () => {
    // String(1e21) === '1e+21' — must expand, not fail the charset whitelist.
    const values = new Map([
      ['f1', 1e21],
      ['f2', 2],
    ]);
    expect(evaluateExpression('{f1} + {f2}', values)).toEqual({ value: 1e21 + 2 });
    const tiny = new Map([['f1', 1e-9]]);
    expect(evaluateExpression('{f1} * 2', tiny)).toEqual({ value: 2e-9 });
  });

  it('rejects invalid expression characters', () => {
    expect(evaluateExpression('console.log("x")', new Map())).toEqual({
      error: 'Invalid expression',
    });
  });
});

describe('extractDependsOn', () => {
  it('extracts field IDs from expression', () => {
    const ids = extractDependsOn('{f1} + {f2}');
    expect(ids).toEqual(['f1', 'f2']);
  });

  it('returns empty for expression without tokens', () => {
    expect(extractDependsOn('42')).toEqual([]);
  });

  it('deduplicates repeated field IDs', () => {
    expect(extractDependsOn('{f1} + {f1}')).toEqual(['f1']);
  });
});
