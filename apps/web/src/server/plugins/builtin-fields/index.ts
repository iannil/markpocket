import { z } from 'zod';

import type { FieldTypeContribution, OptionsSchema } from '@markpocket/plugin-sdk';
import { FieldType, selectOptionSchema, type SelectOption } from '@/lib/field-types';

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
  optionsSchema: z.object({ choices: z.array(selectOptionSchema) }) as unknown as OptionsSchema,
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
    expression: z.string(),
    dependsOn: z.array(z.string()),
  }) as unknown as OptionsSchema,
  defaultOptions: () => ({ expression: '', dependsOn: [] }),
  meta: { label: 'Expression', description: 'Computed from other fields' },
  normalizeCellValue: () => ({ error: 'Expression fields are computed, not user-editable' }),
};

const multiSelect: FieldTypeContribution = {
  type: FieldType.MultiSelect,
  optionsSchema: z.object({ choices: z.array(selectOptionSchema) }) as unknown as OptionsSchema,
  defaultOptions: () => ({ choices: [] as SelectOption[] }),
  meta: { label: 'Multi-Select', description: 'Pick multiple from options' },
  normalizeCellValue: (options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
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
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    return { value: String(raw) };
  },
};

const link: FieldTypeContribution = {
  type: FieldType.Link,
  optionsSchema: z.object({ targetTableId: z.string() }) as unknown as OptionsSchema,
  defaultOptions: () => ({ targetTableId: '' }),
  meta: { label: 'Link', description: 'Link to another table' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
    if (arr.length === 0) return { empty: true };
    return { value: arr };
  },
};

const attachment: FieldTypeContribution = {
  type: FieldType.Attachment,
  optionsSchema: z.object({}) as unknown as OptionsSchema,
  defaultOptions: () => ({}),
  meta: { label: 'Attachment', description: 'File upload' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
    if (arr.length === 0) return { empty: true };
    return { value: arr };
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
