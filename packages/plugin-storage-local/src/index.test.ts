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

  it('round-trips extensionless files the same as extended ones', async () => {
    const { localProvider } = await import('./index');
    // makeKey used to emit a bare uuid that assertSafeKey then rejected (500
    // on upload) — extension must be optional end-to-end.
    const key = localProvider.makeKey('Makefile');
    expect(key).toMatch(/^[a-f0-9-]{36}$/);
    await localProvider.put(key, Buffer.from('data'));
    expect((await localProvider.get(key)).toString()).toBe('data');
    await localProvider.remove(key);
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
      await expect(localProvider.getStream?.(key)).rejects.toThrow(/unsafe storage key/);
      await expect(localProvider.remove(key)).rejects.toThrow(/unsafe storage key/);
    }
  });

  it('streams the same bytes get() returns (download path, L-6)', async () => {
    const { localProvider } = await import('./index');
    const key = localProvider.makeKey('big.bin');
    // 多段 payload：断言流式读会按序拼回全部块，而不是只送第一块。
    const payload = Buffer.concat([
      Buffer.from('block-0.'.repeat(64_000)),
      Buffer.from('block-1.'.repeat(64_000)),
      Buffer.from('block-2.'),
    ]);
    await localProvider.put(key, payload);
    const stream = await localProvider.getStream!(key);
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    await new Promise<void>((resolve, reject) => {
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
    await localProvider.remove(key);
  });
});
