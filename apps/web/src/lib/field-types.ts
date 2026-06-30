// Field type model for Phase 1 (5 basic types). Structure ported from teable
// packages/core; semantics adapted to markpocket's Q5 decisions:
//   - single-select cell value = option **id** (teable stores the choice name).
//   - empty cell = no row (Q4); normalizeCellValue signals {empty} so the writer
//     can DELETE instead of storing a null/empty row.

import { z } from 'zod';

export const FieldType = {
  Text: 'text',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  SingleSelect: 'single-select',
} as const;

export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export const FIELD_TYPES = [
  FieldType.Text,
  FieldType.Number,
  FieldType.Boolean,
  FieldType.Date,
  FieldType.SingleSelect,
] as const;

// --- option schemas ---

export const selectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

const optionsSchemas = {
  [FieldType.Text]: z.object({}),
  [FieldType.Number]: z.object({
    precision: z.number().int().min(0).max(10).optional(),
    scale: z.number().int().min(0).max(10).optional(),
  }),
  [FieldType.Boolean]: z.object({}),
  [FieldType.Date]: z.object({
    includeTime: z.boolean().optional(),
  }),
  [FieldType.SingleSelect]: z.object({
    choices: z.array(selectOptionSchema),
  }),
} as const;

export type FieldOptions = Record<string, unknown>;

export function parseOptions(type: FieldType, raw: unknown): FieldOptions {
  const schema = optionsSchemas[type];
  return schema.parse(raw ?? {}) as FieldOptions;
}

export function defaultOptions(type: FieldType): FieldOptions {
  switch (type) {
    case FieldType.Number:
      return { precision: 0 };
    case FieldType.Date:
      return { includeTime: false };
    case FieldType.SingleSelect:
      return { choices: [] as SelectOption[] };
    default:
      return {};
  }
}

// --- cell value normalization (Q4 + Q5) ---

export type CellValue = string | number | boolean;

export type NormalizedCell = { empty: true } | { value: CellValue } | { error: string };

export function normalizeCellValue(
  type: FieldType,
  options: FieldOptions,
  raw: unknown,
): NormalizedCell {
  switch (type) {
    case FieldType.Text: {
      if (raw == null) return { empty: true };
      const s = typeof raw === 'string' ? raw : String(raw);
      return s === '' ? { empty: true } : { value: s };
    }
    case FieldType.Number: {
      if (raw == null || raw === '') return { empty: true };
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isNaN(n) ? { error: 'Invalid number' } : { value: n };
    }
    case FieldType.Boolean: {
      if (raw == null) return { empty: true };
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'Invalid boolean' };
    }
    case FieldType.Date: {
      if (raw == null || raw === '') return { empty: true };
      const s = String(raw);
      return Number.isNaN(Date.parse(s)) ? { error: 'Invalid date' } : { value: s };
    }
    case FieldType.SingleSelect: {
      if (raw == null || raw === '') return { empty: true };
      const id = String(raw);
      const choices = (options.choices as SelectOption[] | undefined) ?? [];
      return choices.some((c) => c.id === id) ? { value: id } : { error: 'Unknown select option' };
    }
  }
}

// --- UI metadata (labels for the field-type picker) ---

export const FIELD_TYPE_META: Record<FieldType, { label: string; description: string }> = {
  [FieldType.Text]: { label: 'Text', description: 'Single-line text' },
  [FieldType.Number]: { label: 'Number', description: 'Numeric value' },
  [FieldType.Boolean]: { label: 'Checkbox', description: 'True / false' },
  [FieldType.Date]: { label: 'Date', description: 'Date or datetime' },
  [FieldType.SingleSelect]: { label: 'Select', description: 'Pick one from options' },
};
