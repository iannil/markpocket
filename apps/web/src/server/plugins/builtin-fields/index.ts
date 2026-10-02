import { z } from 'zod';

import type { FieldTypeContribution, NormalizedCell, OptionsSchema } from '@markpocket/plugin-sdk';
import { FieldType, type SelectOption } from '@/lib/field-types';

// Option-size guards: a field's options ride along on every field.list payload
// and get re-parsed by zod on every write, so unbounded choices/strings are a
// cheap CPU/memory amplifier for an editor. Bounds mirror the shapes the UI
// generates (uuid ids, short names, css-ish colors). A whole-options
// serialized cap (~64KB) belongs at the field-router layer, not per type.
const boundedSelectOption = z.object({
  id: z.string().max(64),
  name: z.string().max(100),
  color: z.string().max(32),
});
const boundedChoices = z.array(boundedSelectOption).max(200);

// Shared array-of-ids normalization (Q5): null/'' → empty, scalar → one-element
// array, array → stringified + deduped. Used by link/attachment; multiSelect
// builds on toIdArray and adds its choice-membership check on top.
function toIdArray(raw: unknown): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
  return [...new Set(arr)];
}

function normalizeIdArray(raw: unknown): NormalizedCell {
  const arr = toIdArray(raw);
  return arr.length === 0 ? { empty: true } : { value: arr };
}

const text: FieldTypeContribution = {
  type: FieldType.Text,
  optionsSchema: z.object({}) as unknown as OptionsSchema,
  defaultOptions: () => ({}),
  meta: { label: 'Text', description: 'Single-line text' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const s = typeof raw === 'string' ? raw : String(raw);
    return s === '' ? { empty: true } : { value: s };
  },
};

const number: FieldTypeContribution = {
  type: FieldType.Number,
  optionsSchema: z.object({
    precision: z.number().int().min(0).max(10).optional(),
    scale: z.number().int().min(0).max(10).optional(),
  }) as unknown as OptionsSchema,
  defaultOptions: () => ({ precision: 0 }),
  meta: { label: 'Number', description: 'Numeric value' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isNaN(n) ? { error: 'Invalid number' } : { value: n };
  },
};

const boolean: FieldTypeContribution = {
  type: FieldType.Boolean,
  optionsSchema: z.object({}) as unknown as OptionsSchema,
  defaultOptions: () => ({}),
  meta: { label: 'Checkbox', description: 'True / false' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    if (typeof raw === 'boolean') return { value: raw };
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'Invalid boolean' };
  },
};

const date: FieldTypeContribution = {
  type: FieldType.Date,
  optionsSchema: z.object({ includeTime: z.boolean().optional() }) as unknown as OptionsSchema,
  defaultOptions: () => ({ includeTime: false }),
  meta: { label: 'Date', description: 'Date or datetime' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const s = String(raw);
    return Number.isNaN(Date.parse(s)) ? { error: 'Invalid date' } : { value: s };
  },
};

const singleSelect: FieldTypeContribution = {
  type: FieldType.SingleSelect,
  optionsSchema: z.object({ choices: boundedChoices }) as unknown as OptionsSchema,
  defaultOptions: () => ({ choices: [] as SelectOption[] }),
  meta: { label: 'Select', description: 'Pick one from options' },
  normalizeCellValue: (options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const id = String(raw);
    const choices = (options.choices as SelectOption[] | undefined) ?? [];
    return choices.some((c) => c.id === id) ? { value: id } : { error: 'Unknown select option' };
  },
};

const expression: FieldTypeContribution = {
  type: FieldType.Expression,
  optionsSchema: z.object({
    // 10k chars is far beyond any sane formula but bounds parser work per write.
    expression: z.string().max(10_000),
    // Server-derived from the expression on every write; bounded so a hostile
    // payload can't smuggle a huge array in ahead of the overwrite.
    dependsOn: z.array(z.string().max(64)).max(500),
  }) as unknown as OptionsSchema,
  defaultOptions: () => ({ expression: '', dependsOn: [] }),
  meta: { label: 'Expression', description: 'Computed from other fields' },
  normalizeCellValue: () => ({ error: 'Expression fields are computed, not user-editable' }),
};

const multiSelect: FieldTypeContribution = {
  type: FieldType.MultiSelect,
  optionsSchema: z.object({ choices: boundedChoices }) as unknown as OptionsSchema,
  defaultOptions: () => ({ choices: [] as SelectOption[] }),
  meta: { label: 'Multi-Select', description: 'Pick multiple from options' },
  normalizeCellValue: (options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const arr = toIdArray(raw);
    if (arr.length === 0) return { empty: true };
    const choices = (options.choices as SelectOption[] | undefined) ?? [];
    if (!arr.every((id) => choices.some((c) => c.id === id))) {
      return { error: 'Unknown select option' };
    }
    return { value: arr };
  },
};

const user: FieldTypeContribution = {
  type: FieldType.User,
  optionsSchema: z.object({}) as unknown as OptionsSchema,
  defaultOptions: () => ({}),
  meta: { label: 'User', description: 'Reference to a user' },
  // Scalar by design: the cell renderer treats a user cell as one user id.
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    return { value: String(raw) };
  },
};

const link: FieldTypeContribution = {
  type: FieldType.Link,
  // A table id (uuid) — the cap keeps junk from being stored as "options".
  optionsSchema: z.object({ targetTableId: z.string().max(64) }) as unknown as OptionsSchema,
  defaultOptions: () => ({ targetTableId: '' }),
  meta: { label: 'Link', description: 'Link to another table' },
  normalizeCellValue: (_options, raw) => normalizeIdArray(raw),
  // Phase-2 check normalize can't do (it's pure): every referenced id must be an
  // existing record of the target table. The host resolves ids with one batched
  // query; missing ids leave dead references (ADR-0005 decision 5's cause).
  validateCellValue: async (options, value, ctx) => {
    const targetTableId = options.targetTableId;
    if (typeof targetTableId !== 'string' || !targetTableId) {
      return 'Link field has no target table';
    }
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    const existing = await ctx.existingRecordIds(ids, targetTableId);
    const missing = ids.filter((id) => !existing.has(id));
    return missing.length > 0 ? `Unknown record id: ${missing.join(', ')}` : null;
  },
};

const attachment: FieldTypeContribution = {
  type: FieldType.Attachment,
  optionsSchema: z.object({}) as unknown as OptionsSchema,
  defaultOptions: () => ({}),
  meta: { label: 'Attachment', description: 'File upload' },
  normalizeCellValue: (_options, raw) => normalizeIdArray(raw),
  // Same phase-2 shape as link above (L-2): normalize is pure and cannot know
  // which ids really exist, so without this check a cell could store an
  // attachment id from another base (or a made-up id) — a dead reference that
  // breaks thumbnails and leaks cross-base object existence. The host resolves
  // ids with one batched query scoped to THIS field's base (the resolver binds
  // table → base at the call site), so a foreign-base id resolves as missing.
  validateCellValue: async (_options, value, ctx) => {
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    if (ids.length === 0) return null;
    const existing = await ctx.existingAttachmentIds(ids);
    const missing = ids.filter((id) => !existing.has(id));
    return missing.length > 0 ? `Unknown attachment id: ${missing.join(', ')}` : null;
  },
};

export const builtinFieldTypes: FieldTypeContribution[] = [
  text,
  number,
  boolean,
  date,
  singleSelect,
  expression,
  multiSelect,
  user,
  link,
  attachment,
];
