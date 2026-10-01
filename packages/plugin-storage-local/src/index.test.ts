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

  it('makeKey never lets filename parts reach the key', async () => {
    const { localProvider } = await import('./index');
    // Traversal payloads must collapse to a safe uuid(+ext) or no ext at all.
    for (const evil of [
      'x./../../tmp/evil',
      'a.png/../../../../tmp/pwned',
      'doc.pdf\n\n<script>',
      '../../etc/passwd',
    ]) {
      const key = localProvider.makeKey(evil);
      expect(key).toMatch(/^[a-f0-9-]+(\.[A-Za-z0-9]{1,8})?$/);
      expect(key).not.toContain('/');
    }
  });

  it('put/get/remove reject unsafe keys', async () => {
    const { localProvider } = await import('./index');
    for (const key of [
      'uuid.png/../../../tmp/evil',
      'uuid./../../etc/passwd',
      '/etc/passwd',
      'uuid.txt ',
      'uuid.png.bak.sh',
    ]) {
      await expect(localProvider.put(key, Buffer.from('x'))).rejects.toThrow(/unsafe storage key/);
      await expect(localProvider.get(key)).rejects.toThrow(/unsafe storage key/);
      await expect(localProvider.remove(key)).rejects.toThrow(/unsafe storage key/);
    }
  });
});
