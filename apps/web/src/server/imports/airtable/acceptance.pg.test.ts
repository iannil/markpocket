import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
        {
          id: 'fldChoice',
          name: 'Choice',
          type: 'singleSelect',
          options: { choices: [{ id: 'selOne', name: 'One' }] },
        },
        { id: 'fldFile', name: 'File', type: 'multipleAttachments' },
        { id: 'fldFormula', name: 'Computed', type: 'formula' },
        { id: 'fldUnsupported', name: 'Unsupported', type: 'button' },
      ],
    },
    {
      id: 'tblTeams',
      name: 'Teams',
      fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText' }],
    },
  ],
};

const people = Array.from({ length: 101 }, (_, i) => ({
  id: `recPerson${i}`,
  fields: {
    fldName: `Person ${i}`,
    ...(i === 0
      ? {
          fldTeam: ['recTeam'],
          fldChoice: 'One',
          fldFile: [
            { id: 'attOne', filename: 'one.txt', url: 'https://v5.airtableusercontent.com/file' },
          ],
          fldFormula: 'computed',
          fldUnsupported: { label: 'skip' },
        }
      : {}),
    ...(i === 1 ? { fldCheck: false } : {}),
  },
}));
const source: AirtableSource = {
  schema: async () => schema,
  async *records(_base, table) {
    if (table === 'tblPeople') {
      yield people.slice(0, 100);
      yield people.slice(100);
    } else yield [{ id: 'recTeam', fields: { fldName: 'Team' } }];
  },
  attachment: async () => Buffer.from('acceptance fixture bytes'),
};

describe.skipIf(process.env.IMPORT_PG_TEST !== '1')('Airtable acceptance on isolated PG16', () => {
  it('commits 102 records across two tables with links and file bytes, and returns the same receipt', async () => {
    const { db } = await import('../../db');
    const s = await import('../../db/schema');
    const { createImporter } = await import('./importer');
    const { createImportService } = await import('./service');
    const userId = randomUUID();
    const dir = await mkdtemp(join(tmpdir(), 'airtable-acceptance-'));
    const originalUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = join(dir, 'uploads');
    try {
      await db
        .insert(s.user)
        .values({ id: userId, name: 'Acceptance fixture', email: `${userId}@example.test` });
      await db.insert(s.workspace).values({ id: userId, name: 'Acceptance fixture' });
      const service = createImportService({
        source: () => source,
        importer: createImporter({ workspaceId: userId, journalDir: join(dir, 'journals') }),
      });
      const input = {
        requestId: randomUUID(),
        sourceBaseId: 'appFixture',
        token: 'fixture-only',
        name: 'Acceptance import',
        schemaHash: preflight(schema, 'appFixture').schemaHash,
        acceptLosses: true,
      };
      const preview = await service.preflightImport(userId, input.sourceBaseId, input.token);
      expect(preview.issues.map((issue) => issue.kind)).toEqual(['snapshot', 'skip']);
      await expect(
        service.startImport(userId, { ...input, acceptLosses: false }),
      ).rejects.toThrow();
      const report = await service.startImport(userId, input);
      expect(report.records).toBe(102);
      expect(report.tables.map((table) => table.records)).toEqual([101, 1]);
      expect(report.attachments).toBe(1);
      expect(report.issues).toHaveLength(2);
      expect(await service.startImport(userId, { ...input, token: '' })).toEqual(report);
      expect(await service.importStatus(userId, input.requestId)).toMatchObject({
        status: 'complete',
        report,
      });
      await expect(service.importStatus('other-user', input.requestId)).rejects.toThrow(
        'Access denied',
      );
      await expect(service.cancelImport('other-user', input.requestId)).rejects.toThrow(
        'Access denied',
      );
      expect(
        await db
          .select()
          .from(s.airtableImportReceipt)
          .where(eq(s.airtableImportReceipt.userId, userId)),
      ).toHaveLength(1);
      const bases = await db.select().from(s.base).where(eq(s.base.createdBy, userId));
      expect(bases).toHaveLength(1);
      const tables = await db.select().from(s.table).where(eq(s.table.baseId, report.baseId));
      const records = await db
        .select()
        .from(s.record)
        .where(
          inArray(
            s.record.tableId,
            tables.map((table) => table.id),
          ),
        );
      expect(records).toHaveLength(102);
      const fields = await db
        .select()
        .from(s.field)
        .where(
          inArray(
            s.field.tableId,
            tables.map((table) => table.id),
          ),
        );
      const cells = await db
        .select()
        .from(s.cell)
        .where(
          inArray(
            s.cell.fieldId,
            fields.map((field) => field.id),
          ),
        );
      const expectedSourceFields = new Map([
        ['tblPeople', ['fldName', 'fldCheck', 'fldTeam', 'fldChoice', 'fldFile', 'fldFormula']],
        ['tblTeams', ['fldName']],
      ]);
      for (const tableReport of report.tables) {
        const tableFields = fields.filter((field) => field.tableId === tableReport.targetId);
        const sourceIds = tableFields
          .filter((field) => !(field.options as { sourceRecordId?: boolean }).sourceRecordId)
          .map((field) => {
            expect(field.options).toMatchObject({
              sourceBaseId: input.sourceBaseId,
              sourceTableId: tableReport.sourceId,
            });
            return (field.options as { sourceFieldId: string }).sourceFieldId;
          });
        expect(sourceIds.sort()).toEqual(expectedSourceFields.get(tableReport.sourceId)!.sort());
        const [sourceIdField] = tableFields.filter(
          (field) => (field.options as { sourceRecordId?: boolean }).sourceRecordId,
        );
        expect(sourceIdField?.options).toMatchObject({
          sourceBaseId: input.sourceBaseId,
          sourceTableId: tableReport.sourceId,
          sourceRecordId: true,
        });
        const tableRecords = records.filter((record) => record.tableId === tableReport.targetId);
        const sourceCells = cells.filter((cell) => cell.fieldId === sourceIdField?.id);
        expect(sourceCells).toHaveLength(tableRecords.length);
        expect(new Set(sourceCells.map((cell) => cell.recordId))).toEqual(
          new Set(tableRecords.map((record) => record.id)),
        );
        const expectedIds =
          tableReport.sourceId === 'tblPeople' ? people.map((person) => person.id) : ['recTeam'];
        expect(sourceCells.map((cell) => cell.value).sort()).toEqual(expectedIds.sort());
      }
      const check = fields.find((field) => field.name === 'Check')!;
      expect(
        cells.filter((cell) => cell.fieldId === check.id && cell.value === false),
      ).toHaveLength(101);
      const teamTable = tables.find((table) => table.name === 'Teams')!;
      const [team] = records.filter((record) => record.tableId === teamTable.id);
      const link = fields.find((field) => field.name === 'Team')!;
      expect(link.options).toMatchObject({ targetTableId: teamTable.id, sourceFieldId: 'fldTeam' });
      expect(cells.find((cell) => cell.fieldId === link.id)?.value).toEqual([team!.id]);
      const choice = fields.find((field) => field.name === 'Choice')!;
      expect(cells.find((cell) => cell.fieldId === choice.id)?.value).toBe(
        (choice.options as { choices: { id: string }[] }).choices[0]!.id,
      );
      expect(fields.some((field) => field.name === 'Computed [snapshot]')).toBe(true);
      expect(fields.some((field) => field.name === 'Unsupported')).toBe(false);
      expect(fields.filter((field) => field.name === 'Airtable record ID')).toHaveLength(2);
      const [attachment] = await db
        .select()
        .from(s.attachment)
        .where(eq(s.attachment.baseId, report.baseId));
      expect(await readFile(join(dir, 'uploads', attachment!.storageKey), 'utf8')).toBe(
        'acceptance fixture bytes',
      );
      expect(await readdir(join(dir, 'journals'))).toHaveLength(0);
    } finally {
      try {
        await db.delete(s.base).where(eq(s.base.createdBy, userId));
        await db.delete(s.workspace).where(eq(s.workspace.id, userId));
        await db.delete(s.user).where(eq(s.user.id, userId));
      } finally {
        if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = originalUploadDir;
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});
