import type { CellValue, FieldOptions, FieldType } from '@/lib/field-types';

export type ImportIssue = {
  tableId: string;
  fieldId: string;
  kind: 'snapshot' | 'skip';
  message: string;
};
export type ImportReport = {
  requestId: string;
  sourceBaseId: string;
  baseId: string;
  tables: { sourceId: string; targetId: string; name: string; records: number }[];
  records: number;
  cells: number;
  attachments: number;
  attachmentBytes: number;
  issues: ImportIssue[];
};
export type ImportInput = {
  requestId: string;
  sourceBaseId: string;
  token: string;
  name: string;
  schemaHash: string;
  acceptLosses: boolean;
};
export type ImportProgress = {
  phase: 'schema' | 'records' | 'attachments' | 'writing';
  records: number;
  attachments: number;
};
export type AirtableChoice = { id: string; name: string; color?: string };
export type AirtableField = {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
};
export type AirtableTable = { id: string; name: string; fields: AirtableField[] };
export type AirtableSchema = { tables: AirtableTable[] };
export type AirtableRecord = { id: string; fields: Record<string, unknown> };
export type AirtableAttachment = {
  id: string;
  url: string;
  filename: string;
  size?: number;
  type?: string;
};
export type MappedField = {
  sourceId: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  sourceType: string;
  targetTableSourceId?: string;
};
export type PreflightTable = {
  sourceId: string;
  name: string;
  fields: MappedField[];
  sourceRecordIdField: MappedField;
};
export type Preflight = { schemaHash: string; tables: PreflightTable[]; issues: ImportIssue[] };
export type MappedValue =
  { empty: true } | { value: CellValue } | { attachments: AirtableAttachment[] };
export interface AirtableSource {
  schema(baseId: string, token: string, signal: AbortSignal): Promise<AirtableSchema>;
  records(
    baseId: string,
    tableId: string,
    token: string,
    signal: AbortSignal,
  ): AsyncIterable<AirtableRecord[]>;
  attachment(url: string, signal: AbortSignal): Promise<Buffer>;
}
export class AirtableImportError extends Error {
  constructor(
    public readonly code:
      | 'invalid_input'
      | 'invalid_url'
      | 'unsafe_address'
      | 'upstream'
      | 'rate_limited'
      | 'limit'
      | 'invalid_data'
      | 'cancelled',
    message: string,
  ) {
    super(message);
    this.name = 'AirtableImportError';
  }
}
