import type { StorageProvider } from '@markpocket/plugin-sdk';

import { storageRegistry } from './registry';

// 按 STORAGE_PROVIDER 解析活动后端，缺省 'local'。
export function getStorage(): StorageProvider {
  return storageRegistry.get(process.env.STORAGE_PROVIDER ?? 'local');
}
