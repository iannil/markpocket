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
  Expression: 'expression',
  MultiSelect: 'multi-select',
  User: 'user',
  Link: 'link',
  Attachment: 'attachment',
} as const;

export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export const FIELD_TYPES = [
  FieldType.Text,
  FieldType.Number,
  FieldType.Boolean,
  FieldType.Date,
  FieldType.SingleSelect,
  FieldType.Expression,
  FieldType.MultiSelect,
  FieldType.User,
  FieldType.Link,
  FieldType.Attachment,
] as const;

// --- option schemas ---

export const selectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export type FieldOptions = Record<string, unknown>;

// --- cell value normalization types (Q4 + Q5) ---

export type CellValue = string | number | boolean | string[];

export type NormalizedCell = { empty: true } | { value: CellValue } | { error: string };

// --- UI metadata (labels for the field-type picker) ---

export const FIELD_TYPE_META: Record<FieldType, { label: string; description: string }> = {
  [FieldType.Text]: { label: 'Text', description: 'Single-line text' },
  [FieldType.Number]: { label: 'Number', description: 'Numeric value' },
  [FieldType.Boolean]: { label: 'Checkbox', description: 'True / false' },
  [FieldType.Date]: { label: 'Date', description: 'Date or datetime' },
  [FieldType.SingleSelect]: { label: 'Select', description: 'Pick one from options' },
  [FieldType.Expression]: { label: 'Expression', description: 'Computed from other fields' },
  [FieldType.MultiSelect]: { label: 'Multi-Select', description: 'Pick multiple from options' },
  [FieldType.User]: { label: 'User', description: 'Reference to a user' },
  [FieldType.Link]: { label: 'Link', description: 'Link to another table' },
  [FieldType.Attachment]: { label: 'Attachment', description: 'File upload' },
};
