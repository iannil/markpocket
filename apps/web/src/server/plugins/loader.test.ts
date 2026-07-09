import { describe, expect, it } from 'vitest';

import { loadPlugins } from './loader';
import { storageRegistry } from './registry';

describe('loadPlugins', () => {
  it('registers each storage contribution into the storage registry', () => {
    const fake = {
      makeKey: () => 'k',
      put: async () => {},
      get: async () => Buffer.from(''),
      remove: async () => {},
    };
    loadPlugins([{ name: 'p', version: '0', storage: [{ name: 'mem', impl: fake }] }]);
    expect(storageRegistry.get('mem')).toBe(fake);
  });
});
