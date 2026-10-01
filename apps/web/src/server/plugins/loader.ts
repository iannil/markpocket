import type { PluginDefinition } from '@markpocket/plugin-sdk';

import { fieldTypeRegistry, storageRegistry } from './registry';

// 编译期加载：遍历清单，把每类具名贡献填进对应注册表。
// 同步、幂等边界由调用方（server/plugins/index.ts 的单次 import）保证。
export function loadPlugins(plugins: readonly PluginDefinition[]): void {
  for (const plugin of plugins) {
    plugin.storage?.forEach((c) => storageRegistry.register(c.name, c.impl));
    plugin.fieldTypes?.forEach((c) => fieldTypeRegistry.register(c.name, c.impl));
  }
}
