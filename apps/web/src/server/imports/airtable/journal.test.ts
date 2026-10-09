import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createJournal, recoverJournals } from './journal';

describe('private file journal', () => {
  it('records keys before put and recovers process leftovers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'airtable-journal-'));
    const journal = await createJournal(randomUUID(), [randomUUID()], dir);
    expect((await stat(journal.path)).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const remove = vi.fn().mockResolvedValue(undefined);
    await recoverJournals(dir, async (_id, recover) => recover(false), remove);
    expect(remove).toHaveBeenCalledOnce();
  });
  it('preserves committed files and preserves journal when removal fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'airtable-journal-'));
    const journal = await createJournal(randomUUID(), [randomUUID()], dir);
    await expect(
      recoverJournals(
        dir,
        async (_id, recover) => recover(false),
        async () => {
          throw Error('disk');
        },
      ),
    ).rejects.toThrow();
    expect(await readFile(journal.path, 'utf8')).toContain('requestId');
    const remove = vi.fn();
    await recoverJournals(dir, async (_id, recover) => recover(true), remove);
    expect(remove).not.toHaveBeenCalled();
  });
  it('retains malformed keys and invalid JSON for manual inspection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'airtable-journal-'));
    const path = join(dir, `${randomUUID()}.json`);
    const remove = vi.fn();
    await writeFile(
      path,
      JSON.stringify({ version: 1, requestId: randomUUID(), keys: ['../outside'] }),
    );
    await expect(
      recoverJournals(dir, async (_id, recover) => recover(false), remove),
    ).rejects.toThrow('Invalid import journal');
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toContain('../outside');
    await writeFile(path, 'not json');
    await expect(
      recoverJournals(dir, async (_id, recover) => recover(false), remove),
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('not json');
  });
  it('rejects symlinks and corrupt journals without deleting them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'airtable-journal-'));
    const outside = await mkdtemp(join(tmpdir(), 'airtable-outside-'));
    const target = join(outside, 'outside');
    await writeFile(target, '{}');
    await symlink(target, join(dir, `${randomUUID()}.json`));
    await expect(
      recoverJournals(dir, async (_id, recover) => recover(false), vi.fn()),
    ).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('{}');
  });
});
