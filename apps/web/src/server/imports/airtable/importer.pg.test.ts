import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { localProvider } from '@markpocket/plugin-storage-local';
import { preflight } from './mapping';
import type { AirtableSchema, AirtableSource } from './types';

const schema: AirtableSchema = {
  tables: [
    {
      id: 'tblPeople',
      name: 'People',
      fields: [
        { id: 'fldName', name: 'Name', type: 'singleLineText' },
        { id: 'fldCheck', name: 'Check', type: 'checkbox' },
        {
          id: 'fldTeam',
          name: 'Team',
          type: 'multipleRecordLinks',
          options: { linkedTableId: 'tblTeams' },
        },
        { id: 'fldFile', name: 'File', type: 'multipleAttachments' },
        {
          id: 'fldSelect',
          name: 'Select',
          type: 'singleSelect',
          options: { choices: [{ id: 'selOne', name: 'One' }] },
        },
      ],
    },
    {
      id: 'tblTeams',
      name: 'Teams',
      fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText' }],
    },
  ],
};
const source: AirtableSource = {
  schema: async () => schema,
  async *records(_base, table) {
    yield table === 'tblPeople'
      ? [
          {
            id: 'recPerson',
            fields: {
              fldName: 'Alice',
              fldTeam: ['recTeam'],
              fldSelect: 'One',
              fldFile: [
                {
                  id: 'attFile',
                  filename: 'a.txt',
                  url: 'https://v5.airtableusercontent.com/file',
                },
              ],
            },
          },
        ]
      : [{ id: 'recTeam', fields: { fldName: 'Team' } }];
  },
  attachment: async () => Buffer.from('fixture bytes'),
};

describe.skipIf(process.env.IMPORT_PG_TEST !== '1')('atomic importer PostgreSQL', () => {
  it('creates two linked tables, false, choice and bytes exactly once; rolls back on failure', async () => {
    const { db } = await import('../../db');
    const s = await import('../../db/schema');
    const { createImportService } = await import('./service');
    const { createImporter, cleanupImports } = await import('./importer');
    const userId = randomUUID();
    const dir = await mkdtemp(join(tmpdir(), 'airtable-import-pg-'));
    process.env.UPLOAD_DIR = join(dir, 'uploads');
    await db
      .insert(s.user)
      .values({ id: userId, name: 'Import fixture', email: `${userId}@example.test` });
    await db.insert(s.workspace).values({ id: userId, name: 'Import fixture' });
    let notifications = 0;
    const importer = createImporter({
      workspaceId: userId,
      journalDir: join(dir, 'journals'),
      publish: async () => {
        notifications++;
        throw Error('notification failure');
      },
    });
    const service = createImportService({ source: () => source, importer });
    const input = {
      requestId: randomUUID(),
      sourceBaseId: 'appFixture',
      token: 'secret',
      name: 'Imported',
      schemaHash: preflight(schema, 'appFixture').schemaHash,
      acceptLosses: true,
    };
    try {
      const report = await service.startImport(userId, input);
      expect(report.records).toBe(2);
      expect(report.attachments).toBe(1);
      expect(await service.startImport(userId, { ...input, token: '' })).toEqual(report);
      const [a, b] = await Promise.all([
        service.startImport(userId, input),
        service.startImport(userId, input),
      ]);
      expect(a.baseId).toBe(b.baseId);
      expect(notifications).toBe(1);
      const tables = await db.select().from(s.table).where(eq(s.table.baseId, report.baseId));
      const fields = await db
        .select()
        .from(s.field)
        .where(
          inArray(
            s.field.tableId,
            tables.map((t) => t.id),
          ),
        );
      const cells = await db
        .select()
        .from(s.cell)
        .where(
          inArray(
            s.cell.fieldId,
            fields.map((f) => f.id),
          ),
        );
      expect(
        cells.find((c) => c.fieldId === fields.find((f) => f.name === 'Check')!.id)?.value,
      ).toBe(false);
      expect(cells.filter((c) => c.value === 'recPerson')).toHaveLength(1);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);
      const [attachment] = await db
        .select()
        .from(s.attachment)
        .where(eq(s.attachment.baseId, report.baseId));
      expect(await readFile(join(dir, 'uploads', attachment!.storageKey), 'utf8')).toBe(
        'fixture bytes',
      );
      const teamTable = tables.find((t) => t.name === 'Teams')!;
      const [teamRecord] = await db
        .select()
        .from(s.record)
        .where(eq(s.record.tableId, teamTable.id));
      const link = fields.find((f) => f.name === 'Team')!;
      expect(link.options).toMatchObject({ targetTableId: teamTable.id, sourceFieldId: 'fldTeam' });
      expect(cells.find((c) => c.fieldId === link.id)!.value).toEqual([teamRecord!.id]);
      const choice = fields.find((f) => f.name === 'Select')!;
      expect(cells.find((c) => c.fieldId === choice.id)!.value).toBe(
        (choice.options as { choices: { id: string }[] }).choices[0]!.id,
      );

      await expect(service.importStatus('other-user', input.requestId)).rejects.toThrow(
        'Access denied',
      );
      const failing = createImportService({
        source: () => source,
        importer: createImporter({
          workspaceId: userId,
          journalDir: join(dir, 'journals'),
          beforeCommit: async () => {
            throw Error('db secret');
          },
        }),
      });
      await expect(
        failing.startImport(userId, { ...input, requestId: randomUUID() }),
      ).rejects.toThrow('Import failed');
      expect(await db.select().from(s.base).where(eq(s.base.createdBy, userId))).toHaveLength(1);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);
      expect(await readdir(join(dir, 'journals'))).toHaveLength(0);
      expect(
        await db
          .select()
          .from(s.airtableImportReceipt)
          .where(eq(s.airtableImportReceipt.userId, userId)),
      ).toHaveLength(1);
      await expect(service.cancelImport('other-user', input.requestId)).rejects.toThrow(
        'Access denied',
      );
      await expect(service.startImport('other-user', input)).rejects.toThrow('Access denied');
      const abortController = new AbortController();
      const { prepareImport } = await import('./prepare');
      const abortInput = { ...input, requestId: randomUUID() };
      const prepared = await prepareImport(source, abortInput, abortController.signal, {
        phase: 'schema',
        records: 0,
        attachments: 0,
      });
      const abortingImporter = createImporter({
        workspaceId: userId,
        journalDir: join(dir, 'journals'),
        beforeCommit: async () => {
          abortController.abort();
        },
      });
      await expect(
        abortingImporter.write(
          userId,
          abortInput,
          prepared,
          abortController.signal,
          Date.now() + 120000,
        ),
      ).rejects.toThrow('cancelled');
      expect(await db.select().from(s.base).where(eq(s.base.createdBy, userId))).toHaveLength(1);
      expect(await db.select().from(s.record).where(eq(s.record.createdBy, userId))).toHaveLength(
        2,
      );
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);
      const removeFailure = createImportService({
        source: () => source,
        importer: createImporter({
          workspaceId: userId,
          journalDir: join(dir, 'journals'),
          storage: {
            ...localProvider,
            remove: async () => {
              throw Error('disk error');
            },
          },
          beforeCommit: async () => {
            throw Error('rollback');
          },
        }),
      });
      await expect(
        removeFailure.startImport(userId, { ...input, requestId: randomUUID() }),
      ).rejects.toThrow('Import recovery required');
      expect(await readdir(join(dir, 'journals'))).toHaveLength(1);
      expect(await cleanupImports(join(dir, 'journals'))).toBe(1);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);
      const concurrentInput = { ...input, requestId: randomUUID() };
      const concurrentService = createImportService({ source: () => source, importer });
      const concurrent = await Promise.all([
        service.startImport(userId, concurrentInput),
        concurrentService.startImport(userId, {
          ...concurrentInput,
          requestId: concurrentInput.requestId.toUpperCase(),
        }),
      ]);
      expect(concurrent[0]!.baseId).toBe(concurrent[1]!.baseId);
      expect(notifications).toBe(2);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(2);
      expect(await db.select().from(s.base).where(eq(s.base.createdBy, userId))).toHaveLength(2);
      // Transport drops after COMMIT, then recovery cannot reach the database.
      // Keep both journal and committed bytes until the controlled recovery.
      let transactions = 0;
      const uncertainDatabase = new Proxy(db, {
        get(target, property) {
          if (property === 'transaction')
            return async (callback: Parameters<typeof db.transaction>[0]) => {
              transactions++;
              if (transactions === 1) {
                await target.transaction(callback);
                throw Error('connection lost after commit');
              }
              throw Error('database unavailable');
            };
          return Reflect.get(target, property);
        },
      });
      const uncertain = createImportService({
        source: () => source,
        importer: {
          ...createImporter({
            database: async () => uncertainDatabase,
            workspaceId: userId,
            journalDir: join(dir, 'journals'),
          }),
          receipt: importer.receipt,
        },
      });
      const uncertainInput = { ...input, requestId: randomUUID() };
      await expect(uncertain.startImport(userId, uncertainInput)).rejects.toThrow(
        'Import recovery required',
      );
      expect(await readdir(join(dir, 'journals'))).toHaveLength(1);
      const recovered = await service.startImport(userId, { ...uncertainInput, token: '' });
      const [committedAttachment] = await db
        .select()
        .from(s.attachment)
        .where(eq(s.attachment.baseId, recovered.baseId));
      expect(await cleanupImports(join(dir, 'journals'))).toBe(1);
      expect(await readFile(join(dir, 'uploads', committedAttachment!.storageKey), 'utf8')).toBe(
        'fixture bytes',
      );
      expect(await readdir(join(dir, 'journals'))).toHaveLength(0);
      let recoveryEntered!: () => void, releaseRecovery!: () => Promise<void>;
      const recoveryReady = new Promise<void>((resolve) => {
        recoveryEntered = resolve;
      });
      let recoveryTransactions = 0;
      const pendingDatabase = new Proxy(db, {
        get(target, property) {
          if (property === 'transaction')
            return (callback: Parameters<typeof db.transaction>[0]) => {
              if (++recoveryTransactions === 1) return target.transaction(callback);
              return new Promise((resolve, reject) => {
                releaseRecovery = async () => {
                  try {
                    resolve(await target.transaction(callback));
                  } catch (error) {
                    reject(error);
                  }
                };
                recoveryEntered();
              });
            };
          return Reflect.get(target, property);
        },
      });
      const delayedRecoveryImporter = createImporter({
        database: async () => pendingDatabase,
        workspaceId: userId,
        journalDir: join(dir, 'journals'),
        beforeCommit: async () => {
          throw Error('rollback');
        },
      });
      const delayedRecovery = createImportService({
        deadlineMs: 150,
        source: () => source,
        importer: { ...delayedRecoveryImporter, receipt: importer.receipt },
      });
      const filesBeforeRecovery = (await readdir(join(dir, 'uploads'))).length;
      const pendingRun = delayedRecovery.startImport(userId, { ...input, requestId: randomUUID() });
      const recoveryAssertion = expect(
        Promise.race([
          pendingRun,
          new Promise((resolve) => setTimeout(() => resolve('hung recovery'), 300)),
        ]),
      ).rejects.toThrow('Import recovery required');
      await recoveryReady;
      try {
        await recoveryAssertion;
      } finally {
        await releaseRecovery();
      }
      expect(await readdir(join(dir, 'journals'))).toHaveLength(1);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(filesBeforeRecovery + 1);
      expect(
        (await delayedRecovery.preflightImport(userId, input.sourceBaseId, input.token)).tables,
      ).toHaveLength(2);
      expect(await cleanupImports(join(dir, 'journals'))).toBe(1);
      expect(await readdir(join(dir, 'uploads'))).toHaveLength(filesBeforeRecovery);
    } finally {
      await db.delete(s.base).where(eq(s.base.createdBy, userId));
      await db.delete(s.workspace).where(eq(s.workspace.id, userId));
      await db.delete(s.user).where(eq(s.user.id, userId));
    }
  });
});
