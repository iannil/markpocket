import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { definePlugin, type StorageProvider } from '@markpocket/plugin-sdk';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

async function ensureDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export const localProvider: StorageProvider = {
  makeKey(filename) {
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    return `${randomUUID()}${ext}`;
  },
  async put(key, data) {
    await ensureDir();
    await writeFile(join(UPLOAD_DIR, key), data);
  },
  async get(key) {
    return readFile(join(UPLOAD_DIR, key));
  },
  async remove(key) {
    try {
      await unlink(join(UPLOAD_DIR, key));
    } catch {
      // ignore if already gone
    }
  },
};

export default definePlugin({
  name: '@markpocket/plugin-storage-local',
  version: '0.0.0',
  storage: [{ name: 'local', impl: localProvider }],
});
