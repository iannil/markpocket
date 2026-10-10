import { expect, it } from 'vitest';
import { assertTokenCapability, currentTokenScope, runWithTokenScope } from './scope';

it('intersects base and write constraints without leaking across async requests', async () => {
  const a = { tokenId: 't', userId: 'u', baseId: 'a', access: 'read' as const };
  await Promise.all([
    runWithTokenScope(a, async () => {
      expect(() => assertTokenCapability('a', 'viewer')).not.toThrow();
      expect(() => assertTokenCapability('a', 'editor')).toThrow();
      expect(() => assertTokenCapability('a', 'owner')).toThrow();
      expect(() => assertTokenCapability('b', 'viewer')).toThrow();
      await Promise.resolve();
      expect(currentTokenScope()).toEqual(a);
    }),
    runWithTokenScope({ ...a, baseId: 'b', access: 'write' }, async () => {
      await Promise.resolve();
      expect(currentTokenScope()?.baseId).toBe('b');
      expect(() => assertTokenCapability('b', 'owner')).not.toThrow();
      expect(() => assertTokenCapability('a', 'viewer')).toThrow();
    }),
  ]);
  expect(currentTokenScope()).toBeUndefined();
  expect(() => assertTokenCapability('any', 'owner')).not.toThrow();
});

it('supports all-base scopes and restores nested scopes after errors', () => {
  const outer = { tokenId: 't', userId: 'u', baseId: null, access: 'read' as const };
  runWithTokenScope(outer, () => {
    expect(() => assertTokenCapability('any', 'viewer')).not.toThrow();
    expect(() => assertTokenCapability('any', 'editor')).toThrow();
    expect(() =>
      runWithTokenScope({ ...outer, access: 'write' }, () => {
        expect(() => assertTokenCapability('any', 'owner')).not.toThrow();
        throw new Error('callback failed');
      }),
    ).toThrow('callback failed');
    expect(currentTokenScope()).toEqual(outer);
  });
  expect(currentTokenScope()).toBeUndefined();
});
