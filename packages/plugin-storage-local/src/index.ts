import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { definePlugin, type StorageProvider } from '@markpocket/plugin-sdk';

// Storage keys are strictly `<uuid>` or `<uuid>.<safe-ext>` — no path
// separators, no dots beyond an optional extension (files may legitimately have
// none). Every put/get/remove validates, so a hostile key can never traverse
// out of UPLOAD_DIR.
const KEY_RE = /^[a-f0-9-]{8,64}(\.[A-Za-z0-9]{1,8})?$/;

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
  // 流式读取（L-6）：下载路径用 createReadStream 分块送出，文件内容不再
  // 整块进内存 —— 50MB × N 并发的旧路径足以打满 1g 容器。键校验与 get()
  // 一致：不安全的 key 在打开文件前就被拒绝（async 方法里同步 throw 会
  // 变成 rejected promise，调用方拿到的仍是统一语义）。web 流的转换
  // （Readable.toWeb）留给宿主 —— 它还要在源流上挂终态钩子。
  async getStream(key) {
    return createReadStream(assertSafeKey(key));
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
