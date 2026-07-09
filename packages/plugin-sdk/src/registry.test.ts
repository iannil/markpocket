import { describe, expect, it } from 'vitest';

import { createRegistry } from './registry';

describe('createRegistry', () => {
  it('registers and gets by name', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(r.get('a')).toBe(1);
  });

  it('throws on unknown name, listing registered names', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(() => r.get('b')).toThrow(/Unknown thing "b".*Registered: a/);
  });

  it('throws on duplicate registration', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(() => r.register('a', 2)).toThrow(/Duplicate thing "a"/);
  });

  it('tryGet returns undefined instead of throwing', () => {
    const r = createRegistry<number>('thing');
    expect(r.tryGet('x')).toBeUndefined();
  });

  it('list returns all entries', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    r.register('b', 2);
    expect(r.list()).toEqual([
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ]);
  });
});
