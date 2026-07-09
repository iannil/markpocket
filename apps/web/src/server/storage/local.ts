import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { registerStorageProvider, type StorageProvider } from './provider';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

async function ensureDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

function makeKey(filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return `${randomUUID()}${ext}`;
}

async function put(key: string, data: Buffer): Promise<void> {
  await ensureDir();
  await writeFile(join(UPLOAD_DIR, key), data);
}

async function get(key: string): Promise<Buffer> {
  return readFile(join(UPLOAD_DIR, key));
}

async function remove(key: string): Promise<void> {
  try {
    await unlink(join(UPLOAD_DIR, key));
  } catch {
    // ignore if already gone
  }
}

export const localStorageProvider: StorageProvider = { makeKey, put, get, remove };

registerStorageProvider('local', localStorageProvider);
