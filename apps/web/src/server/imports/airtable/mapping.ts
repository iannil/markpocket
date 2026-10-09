import { createHash } from 'node:crypto';
import { FieldType, type SelectOption } from '@/lib/field-types';
import {
  AirtableImportError,
  type AirtableAttachment,
  type AirtableField,
  type AirtableRecord,
  type AirtableSchema,
  type MappedField,
  type MappedValue,
  type Preflight,
} from './types';

const TEXT = new Set([
  'singleLineText',
  'multilineText',
  'richText',
  'email',
  'url',
  'phoneNumber',
]);
const NUMBER = new Set(['number', 'currency', 'percent', 'duration', 'rating']);
const SNAPSHOT = new Set([
  'formula',
  'rollup',
  'multipleLookupValues',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
]);
const PALETTE = new Set([
  'blue',
  'cyan',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'gray',
]);

function invalid(message: string): never {
  throw new AirtableImportError('invalid_data', message);
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;

export function parseSchema(raw: unknown): AirtableSchema {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('tables' in raw) ||
    !Array.isArray(raw.tables) ||
    raw.tables.length > 20
  )
    invalid('Invalid Airtable schema');
  const tableIds = new Set<string>();
  const tables = raw.tables.map((table: unknown) => {
    if (
      !table ||
      typeof table !== 'object' ||
      !('id' in table) ||
      !validId(table.id) ||
      !('name' in table) ||
      !validName(table.name) ||
      !('fields' in table) ||
      !Array.isArray(table.fields) ||
      table.fields.length > 100 ||
      tableIds.has(table.id)
    )
      invalid('Invalid Airtable table');
    tableIds.add(table.id);
    const fieldIds = new Set<string>();
    const fields = table.fields.map((field: unknown) => {
      if (
        !field ||
        typeof field !== 'object' ||
        !('id' in field) ||
        !validId(field.id) ||
        !('name' in field) ||
        !validName(field.name) ||
        !('type' in field) ||
        !validName(field.type) ||
        fieldIds.has(field.id)
      )
        invalid('Invalid Airtable field');
      fieldIds.add(field.id);
      const options = 'options' in field ? field.options : undefined;
      if (
        options !== undefined &&
        (!options || typeof options !== 'object' || Array.isArray(options))
      )
        invalid('Invalid Airtable field options');
      return {
        id: field.id,
        name: field.name,
        type: field.type,
        options: options as Record<string, unknown> | undefined,
      };
    });
    return { id: table.id, name: table.name, fields };
  });
  return { tables };
}

function choiceId(fieldId: string, sourceId: string): string {
  const hex = createHash('sha256').update(fieldId).update(':').update(sourceId).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function selectChoices(field: AirtableField): SelectOption[] {
  const raw = field.options?.choices;
  if (!Array.isArray(raw) || raw.length > 200) invalid('Invalid select choices');
  const ids = new Set<string>();
  const names = new Set<string>();
  return raw.map((choice: unknown) => {
    if (
      !choice ||
      typeof choice !== 'object' ||
      !('id' in choice) ||
      !validId(choice.id) ||
      !('name' in choice) ||
      !validName(choice.name) ||
      ids.has(choice.id) ||
      names.has(choice.name)
    )
      invalid('Invalid select choice');
    ids.add(choice.id);
    names.add(choice.name);
    const color =
      'color' in choice && typeof choice.color === 'string'
        ? choice.color
            .toLowerCase()
            .replace(/(?:bright|light|dark)[a-z]*$/, '')
            .replace(/\d+$/, '')
        : 'blue';
    return {
      id: choiceId(field.id, choice.id),
      name: choice.name,
      color: PALETTE.has(color) ? color : 'blue',
    };
  });
}

export function mapField(field: AirtableField, schema: AirtableSchema): MappedField | null {
  const base = { sourceId: field.id, name: field.name, sourceType: field.type };
  const source = { sourceBaseId: '', sourceTableId: '', sourceFieldId: field.id };
  if (TEXT.has(field.type)) return { ...base, type: FieldType.Text, options: { ...source } };
  if (NUMBER.has(field.type)) return { ...base, type: FieldType.Number, options: { ...source } };
  if (field.type === 'checkbox')
    return { ...base, type: FieldType.Boolean, options: { ...source } };
  if (field.type === 'date' || field.type === 'dateTime')
    return {
      ...base,
      type: FieldType.Date,
      options: { ...source, includeTime: field.type === 'dateTime' },
    };
  if (field.type === 'singleSelect' || field.type === 'multipleSelects')
    return {
      ...base,
      type: field.type === 'singleSelect' ? FieldType.SingleSelect : FieldType.MultiSelect,
      options: { ...source, choices: selectChoices(field) },
    };
  if (field.type === 'multipleAttachments')
    return { ...base, type: FieldType.Attachment, options: { ...source } };
  if (field.type === 'multipleRecordLinks') {
    const target = field.options?.linkedTableId;
    if (!validId(target) || !schema.tables.some((table) => table.id === target))
      invalid('Link target table is missing');
    return {
      ...base,
      type: FieldType.Link,
      targetTableSourceId: target,
      options: { ...source, sourceTargetTableId: target, targetTableId: '' },
    };
  }
  if (SNAPSHOT.has(field.type))
    return {
      ...base,
      name: `${field.name} [snapshot]`,
      type: FieldType.Text,
      options: { ...source, sourceSnapshot: true },
    };
  return null;
}

export function preflight(input: AirtableSchema, sourceBaseId = ''): Preflight {
  const schema = parseSchema(input);
  const issues: Preflight['issues'] = [];
  const tables = schema.tables.map((table) => {
    const used = new Set(table.fields.map((field) => field.name));
    const collidingField = table.fields.find((field) => field.name === 'Airtable record ID');
    let sourceName = 'Airtable record ID';
    if (collidingField) sourceName = `Airtable record ID [source ${collidingField.id}]`;
    for (let suffix = 2; used.has(sourceName); suffix++) {
      sourceName = `Airtable record ID [source ${collidingField!.id} ${suffix}]`;
    }
    const fields: MappedField[] = [];
    const skippedFieldIds: string[] = [];
    for (const field of table.fields) {
      const mapped = mapField(field, schema);
      if (!mapped) {
        skippedFieldIds.push(field.id);
        issues.push({
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          kind: 'skip',
          message: 'Unsupported Airtable field type',
        });
        continue;
      }
      if (SNAPSHOT.has(field.type))
        issues.push({
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          kind: 'snapshot',
          message: 'Imported as static text snapshot',
        });
      mapped.options = { ...mapped.options, sourceBaseId, sourceTableId: table.id };
      fields.push(mapped);
    }
    const sourceRecordIdField: MappedField = {
      sourceId: `source-${table.id}`,
      name: sourceName,
      type: FieldType.Text,
      options: { sourceBaseId, sourceTableId: table.id, sourceRecordId: true },
      sourceType: 'recordId',
    };
    return {
      sourceId: table.id,
      name: table.name,
      fields,
      sourceFieldIds: table.fields.map((field) => field.id),
      skippedFieldIds,
      sourceRecordIdField,
    };
  });
  const schemaHash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  return { schemaHash, tables, issues };
}

export function mapValue(field: MappedField, raw: unknown): MappedValue {
  if (raw == null || raw === '')
    return field.type === FieldType.Boolean ? { value: false } : { empty: true };
  if (field.sourceType === 'recordId')
    return typeof raw === 'string' ? { value: raw } : invalid('Invalid record ID');
  if (SNAPSHOT.has(field.sourceType)) {
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return value === undefined ? invalid('Invalid snapshot value') : { value };
  }
  if (TEXT.has(field.sourceType))
    return typeof raw === 'string' ? { value: raw } : invalid('Invalid text value');
  if (NUMBER.has(field.sourceType))
    return typeof raw === 'number' && Number.isFinite(raw)
      ? { value: raw }
      : invalid('Invalid number');
  if (field.sourceType === 'checkbox')
    return typeof raw === 'boolean' ? { value: raw } : invalid('Invalid checkbox');
  if (field.sourceType === 'date' || field.sourceType === 'dateTime') {
    if (
      typeof raw !== 'string' ||
      !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?Z)?$/.test(raw) ||
      Number.isNaN(Date.parse(raw))
    )
      invalid('Invalid date');
    if (new Date(raw).toISOString().slice(0, 10) !== raw.slice(0, 10)) invalid('Invalid date');
    return { value: raw };
  }
  if (field.sourceType === 'singleSelect' || field.sourceType === 'multipleSelects') {
    const choices = field.options.choices as SelectOption[];
    const one = (name: unknown) => {
      if (typeof name !== 'string') invalid('Invalid select value');
      const choice = choices.find((item) => item.name === name);
      if (!choice) invalid('Unknown select choice');
      return choice.id;
    };
    if (field.sourceType === 'singleSelect') return { value: one(raw) };
    if (!Array.isArray(raw)) invalid('Invalid multi-select value');
    if (raw.length === 0) return { empty: true };
    return { value: raw.map(one) };
  }
  if (field.sourceType === 'multipleRecordLinks') {
    if (!Array.isArray(raw) || !raw.every(validId)) invalid('Invalid linked records');
    if (raw.length === 0) return { empty: true };
    return { value: raw };
  }
  if (field.sourceType === 'multipleAttachments') {
    if (!Array.isArray(raw)) invalid('Invalid attachments');
    if (raw.length === 0) return { empty: true };
    const attachments: AirtableAttachment[] = raw.map((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('id' in item) ||
        !validId(item.id) ||
        !('url' in item) ||
        typeof item.url !== 'string' ||
        !('filename' in item) ||
        !validName(item.filename)
      )
        invalid('Invalid attachment');
      return {
        id: item.id,
        url: item.url,
        filename: item.filename,
        size: 'size' in item && typeof item.size === 'number' ? item.size : undefined,
        type: 'type' in item && typeof item.type === 'string' ? item.type : undefined,
      };
    });
    return { attachments };
  }
  return invalid('Unsupported mapped value');
}

export function validateRecordValues(
  records: AirtableRecord[],
  table: Preflight['tables'][number],
  targetRecordIds?: Map<string, Set<string>>,
): void {
  const fields = new Map(table.fields.map((field) => [field.sourceId, field]));
  const allowedFieldIds = new Set(table.sourceFieldIds);
  const skippedFieldIds = new Set(table.skippedFieldIds);
  for (const record of records) {
    for (const [id, raw] of Object.entries(record.fields)) {
      if (!allowedFieldIds.has(id)) invalid('Unexpected Airtable field');
      if (skippedFieldIds.has(id)) continue;
      if (raw == null) continue;
      const field = fields.get(id);
      if (!field) continue;
      const value = mapValue(field, raw);
      if (field.type === FieldType.Link && 'value' in value && targetRecordIds) {
        const target = targetRecordIds.get(field.targetTableSourceId ?? '');
        if (!target || !(value.value as string[]).every((recordId) => target.has(recordId)))
          invalid('Dangling linked record');
      }
    }
  }
}
