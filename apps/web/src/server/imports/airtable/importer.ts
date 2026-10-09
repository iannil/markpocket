import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { localProvider } from '@markpocket/plugin-storage-local';
import type { StorageProvider } from '@markpocket/plugin-sdk';
import * as s from '../../db/schema';
import {
  cleanJournal,
  createJournal,
  journalDirectory,
  RECOVERY_HINT,
  recoverJournals,
  type Journal,
} from './journal';
import { mapValue } from './mapping';
import { checkSignal, type PreparedImport } from './prepare';
import type { ImportInput, ImportReport } from './types';

type Database = (typeof import('../../db'))['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Importer = {
  receipt(userId: string, requestId: string): Promise<ImportReport | undefined>;
  write(
    userId: string,
    input: ImportInput,
    prepared: PreparedImport,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ImportReport>;
};
export async function lockRequest(tx: Transaction, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
}
async function lookup(tx: Database | Transaction, userId: string, requestId: string) {
  const [receipt] = await tx
    .select()
    .from(s.airtableImportReceipt)
    .where(eq(s.airtableImportReceipt.requestId, requestId));
  if (receipt && receipt.userId !== userId) throw Error('Access denied');
  return receipt?.report;
}
export function createImporter(
  options: {
    database?: () => Promise<Database>;
    workspaceId?: string;
    journalDir?: string;
    storage?: StorageProvider;
    publish?: (baseId: string, userId: string) => Promise<void>;
    beforeCommit?: () => Promise<void>;
  } = {},
): Importer {
  const storage = options.storage ?? localProvider;
  const database = options.database ?? (async () => (await import('../../db')).db);
  return {
    async receipt(userId, requestId) {
      return lookup(await database(), userId, requestId);
    },
    async write(userId, input, prepared, signal, deadlineAt) {
      const db = await database();
      let journal: Journal | undefined;
      let inserted = false;
      let report: ImportReport;
      try {
        report = await db.transaction(async (tx) => {
          async function run<T>(operation: () => Promise<T>): Promise<T> {
            checkSignal(signal);
            const remaining = Math.max(1, Math.min(30000, deadlineAt - Date.now()));
            await tx.execute(
              sql`select set_config('statement_timeout', ${String(remaining)}, true)`,
            );
            const result = await operation();
            checkSignal(signal);
            return result;
          }
          await run(() => lockRequest(tx, input.requestId));
          const existing = await run(() => lookup(tx, userId, input.requestId));
          if (existing) return existing;
          const baseId = randomUUID();
          let workspaceId = options.workspaceId;
          if (!workspaceId) {
            const [workspace] = await run(() => tx.select().from(s.workspace).limit(1));
            workspaceId = workspace?.id ?? 'default';
            if (!workspace)
              await run(() =>
                tx
                  .insert(s.workspace)
                  .values({ id: workspaceId!, name: 'markpocket' })
                  .onConflictDoNothing()
                  .then(() => undefined),
              );
          }
          if (prepared.files.size) {
            journal = await createJournal(
              input.requestId,
              [...prepared.files.values()].map((file) => file.key),
              options.journalDir,
            );
            for (const file of prepared.files.values()) {
              checkSignal(signal);
              await storage.put(file.key, file.bytes);
            }
          }
          await run(() =>
            tx
              .insert(s.base)
              .values({
                id: baseId,
                workspaceId: workspaceId!,
                name: input.name,
                createdBy: userId,
              })
              .then(() => undefined),
          );
          await run(() =>
            tx
              .insert(s.baseMember)
              .values({ baseId, userId, role: 'owner' })
              .then(() => undefined),
          );
          const tables = new Map(
            prepared.preflight.tables.map((table) => [table.sourceId, randomUUID()]),
          );
          const recordIds = new Map<string, Map<string, string>>();
          const fieldIds = new Map<string, Map<string, string>>();
          async function batches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
            for (let index = 0; index < rows.length; index += 250)
              await run(() => insert(rows.slice(index, index + 250)));
          }
          for (const [orderIndex, table] of prepared.preflight.tables.entries()) {
            const tableId = tables.get(table.sourceId)!;
            await run(() =>
              tx
                .insert(s.table)
                .values({ id: tableId, baseId, name: table.name, orderIndex })
                .then(() => undefined),
            );
            await run(() =>
              tx
                .insert(s.view)
                .values({ id: randomUUID(), tableId, type: 'grid', name: 'Grid view' })
                .then(() => undefined),
            );
            const fields = [...table.fields, table.sourceRecordIdField];
            const ids = new Map(fields.map((field) => [field.sourceId, randomUUID()]));
            fieldIds.set(table.sourceId, ids);
            await batches(
              fields.map((field, index) => ({
                id: ids.get(field.sourceId)!,
                tableId,
                name: field.name,
                type: field.type,
                orderIndex: index,
                options: {
                  ...field.options,
                  ...(field.targetTableSourceId
                    ? { targetTableId: tables.get(field.targetTableSourceId)! }
                    : {}),
                },
              })),
              (rows) =>
                tx
                  .insert(s.field)
                  .values(rows)
                  .then(() => undefined),
            );
            const records = prepared.records.get(table.sourceId)!;
            const targetIds = new Map(records.map((record) => [record.id, randomUUID()]));
            recordIds.set(table.sourceId, targetIds);
            await batches(
              records.map((record) => ({
                id: targetIds.get(record.id)!,
                tableId,
                createdBy: userId,
              })),
              (rows) =>
                tx
                  .insert(s.record)
                  .values(rows)
                  .then(() => undefined),
            );
          }
          await batches(
            [...prepared.files.values()].map((file) => ({
              id: file.id,
              baseId,
              filename: file.source.filename,
              mime: file.source.type ?? 'application/octet-stream',
              size: file.bytes.length,
              storageKey: file.key,
              uploadedBy: userId,
            })),
            (rows) =>
              tx
                .insert(s.attachment)
                .values(rows)
                .then(() => undefined),
          );
          for (const table of prepared.preflight.tables) {
            const cells: (typeof s.cell.$inferInsert)[] = [];
            for (const record of prepared.records.get(table.sourceId)!) {
              checkSignal(signal);
              const recordId = recordIds.get(table.sourceId)!.get(record.id)!;
              cells.push({
                id: randomUUID(),
                recordId,
                fieldId: fieldIds.get(table.sourceId)!.get(table.sourceRecordIdField.sourceId)!,
                value: record.id,
              });
              for (const field of table.fields) {
                const mapped = mapValue(field, record.fields[field.sourceId]);
                if ('empty' in mapped) continue;
                let value =
                  'attachments' in mapped
                    ? mapped.attachments.map((file) => prepared.files.get(file.id)!.id)
                    : mapped.value;
                if (field.targetTableSourceId)
                  value = (value as string[]).map((id) =>
                    recordIds.get(field.targetTableSourceId!)!.get(id)!,
                  );
                cells.push({
                  id: randomUUID(),
                  recordId,
                  fieldId: fieldIds.get(table.sourceId)!.get(field.sourceId)!,
                  value,
                });
              }
            }
            await batches(cells, (rows) =>
              tx
                .insert(s.cell)
                .values(rows)
                .then(() => undefined),
            );
          }
          const result: ImportReport = {
            requestId: input.requestId,
            sourceBaseId: input.sourceBaseId,
            baseId,
            tables: prepared.preflight.tables.map((table) => ({
              sourceId: table.sourceId,
              targetId: tables.get(table.sourceId)!,
              name: table.name,
              records: prepared.records.get(table.sourceId)!.length,
            })),
            records: [...prepared.records.values()].reduce((sum, rows) => sum + rows.length, 0),
            cells: prepared.cells,
            attachments: prepared.files.size,
            attachmentBytes: [...prepared.files.values()].reduce(
              (sum, file) => sum + file.bytes.length,
              0,
            ),
            issues: prepared.preflight.issues,
          };
          await run(() =>
            tx
              .insert(s.airtableImportReceipt)
              .values({
                requestId: input.requestId,
                userId,
                sourceBaseId: input.sourceBaseId,
                baseId,
                report: result,
              })
              .then(() => undefined),
          );
          await options.beforeCommit?.();
          checkSignal(signal);
          inserted = true;
          return result;
        });
      } catch (error) {
        // Always reconcile under the same lock. A rejected COMMIT can still have
        // committed, and another process may be finishing this request.
        try {
          const recovered = await db.transaction(async (tx) => {
            await lockRequest(tx, input.requestId);
            const existing = await lookup(tx, userId, input.requestId);
            if (journal) await cleanJournal(journal, !!existing, (key) => storage.remove(key));
            return existing;
          });
          if (recovered) report = recovered;
          else throw error;
        } catch (recoveryError) {
          if (recoveryError === error) throw error;
          // Recovery errors may contain database credentials; never attach their cause.
          // eslint-disable-next-line preserve-caught-error
          throw Error(RECOVERY_HINT);
        }
      }
      if (journal) {
        // Journal deletion failure after confirmed commit must not report a
        // failed import. The recovery command will retain all committed files.
        try {
          await journal.discard();
        } catch {
          /* retained for administrator recovery */
        }
      }
      if (inserted) {
        try {
          const publish =
            options.publish ?? (await import('../../realtime/publish')).publishBaseChange;
          await publish(report.baseId, userId);
        } catch {
          /* committed successfully */
        }
      }
      return report;
    },
  };
}
export async function cleanupImports(dir = journalDirectory()) {
  const { db } = await import('../../db');
  return recoverJournals(
    dir,
    (requestId, recover) =>
      db.transaction(async (tx) => {
        await lockRequest(tx, requestId);
        const [receipt] = await tx
          .select({ id: s.airtableImportReceipt.requestId })
          .from(s.airtableImportReceipt)
          .where(eq(s.airtableImportReceipt.requestId, requestId));
        await recover(!!receipt);
      }),
    (key) => localProvider.remove(key),
  );
}
