import {
  createRegistry,
  type Registry,
  type StorageProvider,
  type FieldTypeContribution,
} from '@markpocket/plugin-sdk';

// Extension-point registries — every one of these has a real consumer today
// (storage: plugins/storage.ts; fieldType: plugins/field-value.ts). New
// extension points get a registry when the first plugin needs them, not before.
export const storageRegistry: Registry<StorageProvider> = createRegistry('storage provider');
export const fieldTypeRegistry: Registry<FieldTypeContribution> = createRegistry('field type');
