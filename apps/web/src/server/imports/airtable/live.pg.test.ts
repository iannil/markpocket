import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, it } from 'vitest';
import type { FieldOptions, SelectOption } from '@/lib/field-types';
import { createAirtableSource } from './client';
import { preflight } from './mapping';
import { assertIdSetEqual, requireLiveEnvironment, sha256, sourceFingerprint } from './reconcile';
import {
  AirtableImportError,
  type AirtableAttachment,
  type AirtableRecord,
  type AirtableSchema,
  type AirtableSource,
} from './types';

const enabled = process.env.AIRTABLE_LIVE_TEST === '1';
const knownBytes = Buffer.from('markpocket live acceptance fixture\n');
const limits = { records: 1000, attachments: 20, bytes: 20 * 1024 * 1024 };
// Boolean-only assertions prevent Vitest from formatting source data in failure diffs.
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Live reconciliation check failed');
}
const empty = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

async function sample(
  source: AirtableSource,
  schema: AirtableSchema,
  baseId: string,
  token: string,
  signal: AbortSignal,
) {
  const result = new Map<string, AirtableRecord[]>();
  let count = 0;
  for (const table of schema.tables) {
    const rows: AirtableRecord[] = [];
    for await (const page of source.records(baseId, table.id, token, signal)) {
      count += page.length;
      check(count <= limits.records);
      rows.push(...page);
    }
    assertIdSetEqual(
      rows.map((row) => row.id),
      rows.map((row) => row.id),
    );
    result.set(table.id, rows);
  }
  return result;
}

function fixtureContract(schema: AirtableSchema, records: Map<string, AirtableRecord[]>) {
  const people = schema.tables.find((table) => table.name === 'People');
  const teams = schema.tables.find((table) => table.name === 'Teams');
  check(people && teams);
  check(records.get(people.id)!.length >= 101 && records.get(teams.id)!.length >= 1);
  const rows = records.get(people.id)!;
  check(
    people.fields.some(
      (field) =>
        field.type === 'multipleRecordLinks' &&
        field.options?.linkedTableId === teams.id &&
        rows.some((row) => !empty(row.fields[field.id])),
    ),
  );
  check(
    people.fields.some(
      (field) =>
        field.type === 'singleSelect' &&
        new Set(rows.map((row) => row.fields[field.id]).filter((value) => !empty(value))).size >= 2,
    ),
  );
  check(
    people.fields.some(
      (field) =>
        field.type === 'checkbox' &&
        rows.some((row) => row.fields[field.id] === true) &&
        rows.some((row) => row.fields[field.id] === false || row.fields[field.id] == null),
    ),
  );
  check(
    people.fields.some(
      (field) => field.type === 'formula' && rows.some((row) => !empty(row.fields[field.id])),
    ),
  );
  check(people.fields.some((field) => field.type === 'button'));
  check(
    people.fields.some(
      (field) =>
        field.type === 'multipleAttachments' && rows.some((row) => !empty(row.fields[field.id])),
    ),
  );
}

describe.skipIf(!enabled)('read-only live Airtable reconciliation', () => {
  it('reconciles real records, links, values, file bytes, losses, replay and source stability', async () => {
    // This guard must fail, not skip, when live mode is explicitly selected without credentials.
    const { baseId, token } = requireLiveEnvironment(process.env);
    let stage = 'setup';
    try {
      const { withDbFixture } = await import('../../testing/pg-fixture');
      await withDbFixture(async (fixture) => {
        const { db } = await import('../../db');
        const s = await import('../../db/schema');
        const { createImporter } = await import('./importer');
        const { createImportService } = await import('./service');
        const dir = await mkdtemp(join(tmpdir(), 'markpocket-live-'));
        const uploads = join(dir, 'uploads');
        const oldUploads = process.env.UPLOAD_DIR;
        process.env.UPLOAD_DIR = uploads;
        const signal = AbortSignal.timeout(360_000);
        try {
          const service = createImportService({
            source: () => createAirtableSource(),
            importer: createImporter({
              workspaceId: fixture.workspaceId,
              journalDir: join(dir, 'journals'),
            }),
          });
          stage = 'schema-preflight';
          const source = createAirtableSource();
          const schema = await source.schema(baseId, token, signal);
          const preview = await service.preflightImport(fixture.userId, baseId, token);
          check(preflight(schema, baseId).schemaHash === preview.schemaHash);
          stage = 'source-sample';
          const before = await sample(source, schema, baseId, token, signal);
          stage = 'fixture-contract';
          fixtureContract(schema, before);
          const sourceFiles = new Map<string, { digest: string; size: number }>();
          let sourceBytes = 0;
          stage = 'source-attachments';
          for (const table of schema.tables)
            for (const field of table.fields.filter(
              (field) => field.type === 'multipleAttachments',
            ))
              for (const row of before.get(table.id)!) {
                const files = row.fields[field.id];
                if (empty(files)) continue;
                check(Array.isArray(files));
                for (const file of files as AirtableAttachment[]) {
                  if (sourceFiles.has(file.id)) continue;
                  check(sourceFiles.size < limits.attachments);
                  const bytes = await source.attachment(file.url, signal);
                  sourceBytes += bytes.length;
                  check(sourceBytes <= limits.bytes);
                  sourceFiles.set(file.id, { digest: sha256(bytes), size: bytes.length });
                }
              }
          check([...sourceFiles.values()].some((file) => file.digest === sha256(knownBytes)));
          const input = {
            requestId: randomUUID(),
            sourceBaseId: baseId,
            token,
            name: 'Live acceptance',
            schemaHash: preview.schemaHash,
            acceptLosses: true,
          };
          stage = 'import';
          const report = await service.startImport(fixture.userId, input);
          stage = 'target-id-sets';
          assertIdSetEqual(
            schema.tables.map((table) => table.id),
            report.tables.map((table) => table.sourceId),
          );
          const storedTables = await db
            .select()
            .from(s.table)
            .where(eq(s.table.baseId, report.baseId));
          assertIdSetEqual(
            report.tables.map((table) => table.targetId),
            storedTables.map((table) => table.id),
          );
          const ids = new Map<string, Map<string, string>>();
          const targets = new Map<
            string,
            { fields: (typeof s.field.$inferSelect)[]; cells: Map<string, unknown> }
          >();
          let recordTotal = 0;
          for (const table of report.tables) {
            const fields = await db
              .select()
              .from(s.field)
              .where(eq(s.field.tableId, table.targetId));
            const records = await db
              .select()
              .from(s.record)
              .where(eq(s.record.tableId, table.targetId));
            const cells = await db
              .select({ recordId: s.cell.recordId, fieldId: s.cell.fieldId, value: s.cell.value })
              .from(s.cell)
              .innerJoin(s.field, eq(s.field.id, s.cell.fieldId))
              .where(eq(s.field.tableId, table.targetId));
            const idFields = fields.filter(
              (field) => (field.options as FieldOptions).sourceRecordId,
            );
            check(idFields.length === 1);
            const idOptions = idFields[0]!.options as FieldOptions;
            check(idOptions.sourceBaseId === baseId && idOptions.sourceTableId === table.sourceId);
            const expectedFields = preview.tables.find(
              (entry) => entry.sourceId === table.sourceId,
            )!;
            assertIdSetEqual(
              expectedFields.fields.map((field) => field.sourceId),
              fields
                .filter((field) => !(field.options as FieldOptions).sourceRecordId)
                .map((field) => String((field.options as FieldOptions).sourceFieldId)),
            );
            const sourceCells = cells.filter((cell) => cell.fieldId === idFields[0]!.id);
            check(sourceCells.every((cell) => typeof cell.value === 'string'));
            assertIdSetEqual(
              before.get(table.sourceId)!.map((row) => row.id),
              sourceCells.map((cell) => cell.value as string),
            );
            assertIdSetEqual(
              records.map((row) => row.id),
              sourceCells.map((cell) => cell.recordId),
            );
            check(table.records === records.length);
            recordTotal += records.length;
            ids.set(
              table.sourceId,
              new Map(sourceCells.map((cell) => [cell.value as string, cell.recordId])),
            );
            targets.set(table.sourceId, {
              fields,
              cells: new Map(cells.map((cell) => [`${cell.recordId}:${cell.fieldId}`, cell.value])),
            });
          }
          check(report.records === recordTotal);
          const attachments = await db
            .select()
            .from(s.attachment)
            .where(eq(s.attachment.baseId, report.baseId));
          const attachedIds: string[] = [];
          const fileTargets = new Map<string, string>();
          stage = 'target-field-values';
          for (const table of schema.tables) {
            const target = targets.get(table.id)!;
            for (const field of table.fields) {
              const matching = target.fields.filter(
                (candidate) => (candidate.options as FieldOptions).sourceFieldId === field.id,
              );
              const issue = preview.issues.find(
                (issue) => issue.tableId === table.id && issue.fieldId === field.id,
              );
              if (issue?.kind === 'skip') {
                check(matching.length === 0);
                continue;
              }
              check(matching.length === 1);
              const targetField = matching[0]!;
              const options = targetField.options as FieldOptions;
              check(options.sourceBaseId === baseId && options.sourceTableId === table.id);
              if (issue?.kind === 'snapshot')
                check(
                  options.sourceSnapshot &&
                    targetField.type === 'text' &&
                    targetField.name === `${field.name} [snapshot]`,
                );
              if (field.type === 'multipleRecordLinks')
                check(
                  options.targetTableId ===
                    report.tables.find(
                      (candidate) => candidate.sourceId === field.options?.linkedTableId,
                    )?.targetId,
                );
              for (const row of before.get(table.id)!) {
                const raw = row.fields[field.id];
                const actual = target.cells.get(
                  `${ids.get(table.id)!.get(row.id)!}:${targetField.id}`,
                );
                if (field.type === 'checkbox') {
                  check(actual === (raw ?? false));
                  continue;
                }
                if (
                  raw == null ||
                  raw === '' ||
                  (Array.isArray(raw) &&
                    raw.length === 0 &&
                    ['multipleRecordLinks', 'multipleSelects', 'multipleAttachments'].includes(
                      field.type,
                    ))
                ) {
                  check(actual === undefined);
                  continue;
                }
                if (field.type === 'multipleRecordLinks') {
                  check(Array.isArray(raw) && Array.isArray(actual));
                  const expected = raw.map((id: string) =>
                    ids.get(field.options!.linkedTableId as string)?.get(id),
                  );
                  check(expected.every((id) => typeof id === 'string'));
                  assertIdSetEqual(expected as string[], actual as string[]);
                } else if (field.type === 'singleSelect' || field.type === 'multipleSelects') {
                  const names = field.type === 'singleSelect' ? [raw] : raw;
                  check(Array.isArray(names));
                  check(Array.isArray(options.choices));
                  const choices = options.choices as SelectOption[];
                  const expected = names.map(
                    (name) => choices.find((choice) => choice.name === name)?.id,
                  );
                  check(expected.every((id) => typeof id === 'string'));
                  if (field.type === 'singleSelect') check(actual === expected[0]);
                  else {
                    check(Array.isArray(actual));
                    assertIdSetEqual(expected as string[], actual as string[]);
                  }
                } else if (field.type === 'multipleAttachments') {
                  check(
                    Array.isArray(raw) && Array.isArray(actual) && raw.length === actual.length,
                  );
                  for (let index = 0; index < raw.length; index++) {
                    const file = raw[index] as AirtableAttachment;
                    const saved = attachments.find((attachment) => attachment.id === actual[index]);
                    check(saved);
                    check(
                      saved.filename === file.filename &&
                        saved.mime === (file.type ?? 'application/octet-stream'),
                    );
                    const prior = fileTargets.get(file.id);
                    check(!prior || prior === saved.id);
                    fileTargets.set(file.id, saved.id);
                    attachedIds.push(saved.id);
                    const path = resolve(uploads, saved.storageKey);
                    check(path.startsWith(`${resolve(uploads)}${sep}`));
                    const bytes = await readFile(path);
                    check(
                      sha256(bytes) === sourceFiles.get(file.id)?.digest &&
                        bytes.length === saved.size &&
                        saved.size === sourceFiles.get(file.id)?.size,
                    );
                  }
                } else if (issue?.kind === 'snapshot')
                  check(actual === (typeof raw === 'string' ? raw : JSON.stringify(raw)));
                else check(JSON.stringify(actual) === JSON.stringify(raw));
              }
            }
          }
          assertIdSetEqual(
            [...new Set(attachedIds)],
            attachments.map((file) => file.id),
          );
          check(
            report.attachments === sourceFiles.size &&
              attachments.length === sourceFiles.size &&
              report.attachmentBytes === sourceBytes,
          );
          stage = 'loss-report';
          assertIdSetEqual(
            preview.issues.map((issue) => `${issue.tableId}:${issue.fieldId}:${issue.kind}`),
            report.issues.map((issue) => `${issue.tableId}:${issue.fieldId}:${issue.kind}`),
          );
          check(
            report.issues.some((issue) => issue.kind === 'snapshot') &&
              report.issues.some((issue) => issue.kind === 'skip'),
          );
          stage = 'receipt-replay';
          const replay = await service.startImport(fixture.userId, { ...input, token: '' });
          check(isDeepStrictEqual(replay, report));
          check(
            (await db.select().from(s.base).where(eq(s.base.createdBy, fixture.userId))).length ===
              2,
          ); // fixture base + exactly one import
          stage = 'source-stability';
          // A fresh real client resets per-scan duplicate tracking; no fetch/network override.
          const afterSource = createAirtableSource();
          const afterSchema = await afterSource.schema(baseId, token, signal);
          check(preflight(afterSchema, baseId).schemaHash === preview.schemaHash);
          const after = await sample(afterSource, afterSchema, baseId, token, signal);
          for (const table of schema.tables) {
            assertIdSetEqual(
              before.get(table.id)!.map((row) => row.id),
              after.get(table.id)!.map((row) => row.id),
            );
            check(
              sourceFingerprint(table, before.get(table.id)!) ===
                sourceFingerprint(table, after.get(table.id)!),
            );
          }
        } finally {
          const previousStage = stage;
          stage = 'cleanup';
          try {
            // The unique fixture owner also catches a committed base if the response was lost.
            await db
              .delete(s.airtableImportReceipt)
              .where(eq(s.airtableImportReceipt.userId, fixture.userId));
            await db.delete(s.base).where(eq(s.base.createdBy, fixture.userId));
          } finally {
            if (oldUploads === undefined) delete process.env.UPLOAD_DIR;
            else process.env.UPLOAD_DIR = oldUploads;
            await rm(dir, { recursive: true, force: true });
          }
          stage = previousStage;
        }
      });
    } catch (error) {
      const code =
        error instanceof AirtableImportError
          ? error.code
          : stage === 'source-stability'
            ? 'source_changed'
            : 'check_failed';
      // Never retain the original cause: network/DB/assertion errors may contain credentials or values.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Live Airtable acceptance failed: stage=${stage}, code=${code}`);
    }
  }, 420_000);
});
