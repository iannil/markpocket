import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalRequestId } from './budget';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECOVERY_HINT =
  'Import recovery required. Run pnpm --filter @markpocket/web exec tsx scripts/cleanup-airtable-imports.ts with the same DATABASE_URL, UPLOAD_DIR and AIRTABLE_IMPORT_JOURNAL_DIR.';
export function journalDirectory() {
  return (
    process.env.AIRTABLE_IMPORT_JOURNAL_DIR ??
    join(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'), '.airtable-import-journals')
  );
}
async function privateDirectory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe import journal directory');
  await chmod(dir, 0o700);
}
export type Journal = { path: string; requestId: string; keys: string[]; discard(): Promise<void> };
export async function createJournal(
  requestId: string,
  keys: string[],
  dir = journalDirectory(),
): Promise<Journal> {
  requestId = canonicalRequestId(requestId);
  if (!UUID.test(requestId) || keys.some((key) => !UUID.test(key)) || keys.length > 200)
    throw Error('Invalid import journal');
  await privateDirectory(dir);
  const path = join(dir, `${randomUUID()}.json`);
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify({ version: 1, requestId, keys }));
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Persist the directory entry before any attachment is put.
  const directory = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return { path, requestId, keys, discard: () => unlink(path) };
}
export async function cleanJournal(
  journal: Journal,
  committed: boolean,
  remove: (key: string) => Promise<void>,
  guard: () => void = () => {},
) {
  if (!committed)
    for (const key of journal.keys) {
      guard();
      await remove(key);
    }
  guard();
  await journal.discard();
}
// withLock must retain the request's database advisory lock until recover resolves.
export async function recoverJournals(
  dir: string,
  withLock: (
    requestId: string,
    recover: (committed: boolean, guard?: () => void) => Promise<void>,
  ) => Promise<void>,
  remove: (key: string) => Promise<void>,
) {
  await privateDirectory(dir);
  let recovered = 0;
  for (const name of await readdir(dir)) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) throw Error('Unexpected import journal entry');
    const path = join(dir, name);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let data: { version: number; requestId: string; keys: string[] };
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 16384 || info.nlink !== 1)
        throw Error('Unsafe import journal');
      data = JSON.parse(await handle.readFile('utf8'));
      if (
        data.version !== 1 ||
        !UUID.test(data.requestId) ||
        !Array.isArray(data.keys) ||
        data.keys.length > 200 ||
        data.keys.some((key) => typeof key !== 'string' || !UUID.test(key))
      )
        throw Error('Invalid import journal');
    } finally {
      await handle.close();
    }
    data.requestId = canonicalRequestId(data.requestId);
    await withLock(data.requestId, async (committed, guard = () => {}) => {
      guard();
      // A successful importer may have removed the journal while we waited.
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw Error('Unsafe import journal');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      await cleanJournal({ ...data, path, discard: () => unlink(path) }, committed, remove, guard);
      recovered++;
    });
  }
  return recovered;
}
