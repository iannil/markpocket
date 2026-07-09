import { createRegistry, type Registry, type StorageProvider } from '@markpocket/plugin-sdk';

// 6 个扩展点注册表，全部同形（createRegistry）。本计划只有 storage 有真实贡献；
// 其余为骨架，供 Field Type / View / UI Slot / Event / Auth 各自计划填充。
export const storageRegistry: Registry<StorageProvider> = createRegistry('storage provider');
export const fieldTypeRegistry: Registry<unknown> = createRegistry('field type');
export const viewTypeRegistry: Registry<unknown> = createRegistry('view type');
export const uiSlotRegistry: Registry<unknown> = createRegistry('ui slot');
export const eventRegistry: Registry<unknown> = createRegistry('event handler');
export const authProviderRegistry: Registry<unknown> = createRegistry('auth provider');
