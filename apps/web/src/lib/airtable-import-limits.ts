export const AIRTABLE_LIMITS = {
  tables: 20,
  fieldsPerTable: 100,
  records: 10_000,
  cells: 100_000,
  recordsBytes: 16 * 1024 * 1024,
  attachments: 200,
  attachmentBytes: 10 * 1024 * 1024,
  totalAttachmentBytes: 64 * 1024 * 1024,
  metadataBytes: 2 * 1024 * 1024,
} as const;

export const AIRTABLE_IMPORT_DEADLINE_MS = 120_000;

export function formatAirtableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${Number((bytes / 1024 ** (index + 1)).toFixed(1))} ${units[index]}`;
}
