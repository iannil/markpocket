import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

async function ensureDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export function makeKey(filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return `${randomUUID()}${ext}`;
}

export async function put(key: string, data: Buffer): Promise<void> {
  await ensureDir();
  await writeFile(join(UPLOAD_DIR, key), data);
}

export async function get(key: string): Promise<Buffer> {
  return readFile(join(UPLOAD_DIR, key));
}

export async function remove(key: string): Promise<void> {
  try {
    await unlink(join(UPLOAD_DIR, key));
  } catch {
    // ignore if already gone
  }
}
