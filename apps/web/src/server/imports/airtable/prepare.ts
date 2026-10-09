import { randomUUID } from 'node:crypto';
import { AIRTABLE_LIMITS } from './client';
import { mapValue, preflight, validateRecordValues } from './mapping';
import {
  AirtableImportError,
  type AirtableAttachment,
  type AirtableRecord,
  type AirtableSource,
  type ImportInput,
  type ImportProgress,
  type Preflight,
} from './types';

export function checkSignal(signal: AbortSignal) {
  if (signal.aborted)
    throw new AirtableImportError('cancelled', 'Import cancelled or deadline exceeded');
}
export type PreparedImport = {
  preflight: Preflight;
  records: Map<string, AirtableRecord[]>;
  files: Map<string, { source: AirtableAttachment; id: string; key: string; bytes: Buffer }>;
  cells: number;
};
export async function prepareImport(
  source: AirtableSource,
  input: ImportInput,
  signal: AbortSignal,
  progress: ImportProgress,
): Promise<PreparedImport> {
  checkSignal(signal);
  const plan = preflight(
    await source.schema(input.sourceBaseId, input.token, signal),
    input.sourceBaseId,
  );
  checkSignal(signal);
  if (plan.schemaHash !== input.schemaHash)
    throw new AirtableImportError('invalid_input', 'Source schema changed; run preflight again');
  if (plan.issues.length && !input.acceptLosses)
    throw new AirtableImportError('invalid_input', 'Confirm field conversions and skipped fields');
  const records = new Map<string, AirtableRecord[]>();
  const allIds = new Map<string, Set<string>>();
  const files: PreparedImport['files'] = new Map();
  let cells = 0,
    recordBytes = 0,
    attachmentBytes = 0;
  progress.phase = 'records';
  for (const table of plan.tables) {
    const rows: AirtableRecord[] = [],
      ids = new Set<string>();
    for await (const batch of source.records(
      input.sourceBaseId,
      table.sourceId,
      input.token,
      signal,
    )) {
      checkSignal(signal);
      validateRecordValues(batch, table);
      for (const row of batch) {
        if (ids.has(row.id)) throw new AirtableImportError('invalid_data', 'Duplicate record ID');
        ids.add(row.id);
        recordBytes += Buffer.byteLength(JSON.stringify(row));
        cells++; // source record ID
        for (const field of table.fields) {
          const mapped = mapValue(field, row.fields[field.sourceId]);
          if (!('empty' in mapped)) cells++;
          if ('attachments' in mapped)
            for (const file of mapped.attachments) {
              const previous = files.get(file.id);
              if (
                previous &&
                (previous.source.url !== file.url || previous.source.filename !== file.filename)
              )
                throw new AirtableImportError('invalid_data', 'Conflicting attachment identity');
              if (!previous)
                files.set(file.id, {
                  source: file,
                  id: randomUUID(),
                  key: randomUUID(),
                  bytes: Buffer.alloc(0),
                });
            }
        }
        rows.push(row);
        progress.records++;
        if (
          progress.records > AIRTABLE_LIMITS.records ||
          cells > AIRTABLE_LIMITS.cells ||
          recordBytes > AIRTABLE_LIMITS.recordsBytes ||
          files.size > AIRTABLE_LIMITS.attachments
        )
          throw new AirtableImportError('limit', 'Import data limit exceeded');
      }
    }
    records.set(table.sourceId, rows);
    allIds.set(table.sourceId, ids);
  }
  for (const table of plan.tables)
    validateRecordValues(records.get(table.sourceId)!, table, allIds);
  progress.phase = 'attachments';
  for (const file of files.values()) {
    checkSignal(signal);
    file.bytes = await source.attachment(file.source.url, signal);
    checkSignal(signal);
    attachmentBytes += file.bytes.length;
    if (
      file.bytes.length > AIRTABLE_LIMITS.attachmentBytes ||
      attachmentBytes > AIRTABLE_LIMITS.totalAttachmentBytes
    )
      throw new AirtableImportError('limit', 'Attachment byte limit exceeded');
    progress.attachments++;
  }
  checkSignal(signal);
  return { preflight: plan, records, files, cells };
}
