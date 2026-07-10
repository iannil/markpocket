import csvServer from '@markpocket/plugin-csv/server';
import storageLocal from '@markpocket/plugin-storage-local';
import type { PluginDefinition } from '@markpocket/plugin-sdk';

import { coreServerApi } from '@/server/plugins/core-api';

// 唯一的静态组装点：装插件 = 在此加一行 + docker build。
// 声明了 tRPC router 的插件（后续计划）还需在此处的 pluginRouters 静态合并。
export const plugins: readonly PluginDefinition[] = [storageLocal];

// 声明了 tRPC router 的插件在此静态合并 —— 唯一手工维护处。
export const pluginRouters = {
  csv: csvServer(coreServerApi),
} as const;
