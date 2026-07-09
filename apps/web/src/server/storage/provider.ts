// Storage provider seam (ADR-0006). The core depends only on this interface;
// concrete backends register themselves and are resolved by STORAGE_PROVIDER.
// Built-in: 'local' (disk). Future paid plugins (S3 / MinIO / WebDAV) register
// additional providers without touching core call sites.

export interface StorageProvider {
  /** Generate a storage key for a new upload, preserving the file extension. */
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const providers = new Map<string, StorageProvider>();

/** Register a storage backend under a name (called at module load by each provider). */
export function registerStorageProvider(name: string, provider: StorageProvider): void {
  providers.set(name, provider);
}

/** Resolve the active provider from STORAGE_PROVIDER (default 'local'). */
export function getStorage(): StorageProvider {
  const name = process.env.STORAGE_PROVIDER ?? 'local';
  const provider = providers.get(name);
  if (!provider) {
    const known = [...providers.keys()].join(', ') || '(none registered)';
    throw new Error(`Unknown STORAGE_PROVIDER "${name}". Registered providers: ${known}`);
  }
  return provider;
}
