import { z } from 'zod';

export const PUBLIC_FORM_TYPES = new Set([
  'text',
  'number',
  'boolean',
  'date',
  'single-select',
  'multi-select',
]);

export const formConfigSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  fields: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        required: z.boolean(),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (fields) => new Set(fields.map((field) => field.fieldId)).size === fields.length,
      'Duplicate fields',
    ),
  successMessage: z.string().min(1).max(500).default('Thank you. Your response has been received.'),
});

export type FormConfig = z.infer<typeof formConfigSchema>;

export function validateFormFields(
  config: FormConfig,
  fields: { id: string; type: string }[],
): void {
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const field of config.fields) {
    if (!PUBLIC_FORM_TYPES.has(byId.get(field.fieldId)?.type ?? '')) {
      throw Error('Form field is unavailable');
    }
  }
}
