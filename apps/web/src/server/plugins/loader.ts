import type { FieldTypeContribution, PluginDefinition } from '@markpocket/plugin-sdk';

import {
  authProviderRegistry,
  eventRegistry,
  fieldTypeRegistry,
  storageRegistry,
  uiSlotRegistry,
  viewTypeRegistry,
} from './registry';

// 编译期加载：遍历清单，把每类具名贡献填进对应注册表。
// 同步、幂等边界由调用方（server/plugins/index.ts 的单次 import）保证。
export function loadPlugins(plugins: readonly PluginDefinition[]): void {
  for (const plugin of plugins) {
    plugin.storage?.forEach((c) => storageRegistry.register(c.name, c.impl));
    // PluginDefinition.fieldTypes 仍是 Contribution<unknown>（后续计划收紧）；
    // 注册表已收紧为 Registry<FieldTypeContribution>，此处在调用点收窄。
    plugin.fieldTypes?.forEach((c) =>
      fieldTypeRegistry.register(c.name, c.impl as FieldTypeContribution),
    );
    plugin.viewTypes?.forEach((c) => viewTypeRegistry.register(c.name, c.impl));
    plugin.uiSlots?.forEach((c) => uiSlotRegistry.register(c.name, c.impl));
    plugin.events?.forEach((c) => eventRegistry.register(c.name, c.impl));
    plugin.authProviders?.forEach((c) => authProviderRegistry.register(c.name, c.impl));
  }
}
