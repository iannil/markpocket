import { describe, expect, it } from 'vitest';

import { fmtTime, fmtVal } from './format';

describe('fmtVal', () => {
  it('renders empty markers', () => {
    expect(fmtVal(null)).toBe('(empty)');
    expect(fmtVal(undefined)).toBe('(empty)');
    expect(fmtVal('')).toBe('(empty)');
  });

  it('renders primitives directly', () => {
    expect(fmtVal('hello')).toBe('hello');
    expect(fmtVal(42)).toBe('42');
    expect(fmtVal(false)).toBe('false');
  });

  it('summarizes arrays and marker errors', () => {
    expect(fmtVal([1, 2, 3])).toBe('[3 items]');
    expect(fmtVal({ __error: 'boom' })).toBe('error: boom');
  });
});

describe('fmtTime', () => {
  it('uses relative buckets', () => {
    const now = Date.now();
    expect(fmtTime(new Date(now - 5_000).toISOString())).toBe('just now');
    expect(fmtTime(new Date(now - 120_000).toISOString())).toBe('2m ago');
    expect(fmtTime(new Date(now - 2 * 3_600_000).toISOString())).toBe('2h ago');
  });
});
