import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mp-storage-'));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('plugin-storage-local', () => {
  it('exposes a local storage contribution', async () => {
    const plugin = (await import('./index')).default;
    expect(plugin.storage?.[0]?.name).toBe('local');
  });

  it('round-trips put/get/remove', async () => {
    const { localProvider } = await import('./index');
    const key = localProvider.makeKey('note.txt');
    await localProvider.put(key, Buffer.from('hi'));
    expect((await localProvider.get(key)).toString()).toBe('hi');
    await localProvider.remove(key);
    await expect(localProvider.get(key)).rejects.toThrow();
  });
});
