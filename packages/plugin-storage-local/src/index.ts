import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { definePlugin, type StorageProvider } from '@markpocket/plugin-sdk';

// Storage keys are strictly `<uuid>.<safe-ext>` — no path separators, no dots
// beyond the extension. Every put/get/remove validates, so a hostile key can
// never traverse out of UPLOAD_DIR.
const KEY_RE = /^[a-f0-9-]{8,64}\.[A-Za-z0-9]{1,8}$/;

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function assertSafeKey(key: string): string {
  if (!KEY_RE.test(key)) {
    throw new Error(`Refusing unsafe storage key: ${JSON.stringify(key)}`);
  }
  return join(uploadDir(), key);
}

export const localProvider: StorageProvider = {
  makeKey(filename) {
    const ext = (filename.match(/\.[A-Za-z0-9]{1,8}$/) ?? [''])[0];
    return `${randomUUID()}${ext}`;
  },
  async put(key, data) {
    const path = assertSafeKey(key);
    await ensureDir(uploadDir());
    await writeFile(path, data);
  },
  async get(key) {
    return readFile(assertSafeKey(key));
  },
  async remove(key) {
    try {
      await unlink(assertSafeKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  },
};

export default definePlugin({
  name: '@markpocket/plugin-storage-local',
  version: '0.0.0',
  storage: [{ name: 'local', impl: localProvider }],
});
