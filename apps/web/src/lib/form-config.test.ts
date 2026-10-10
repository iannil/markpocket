import { describe, expect, it } from 'vitest';
import { formConfigSchema, PUBLIC_FORM_TYPES, validateFormFields } from './form-config';

const draft = { title: 'Contact', fields: [{ fieldId: 'f', required: true }] };

describe('form configuration', () => {
  it('accepts explicit scalar projection and rejects non-public field types', () => {
    const config = formConfigSchema.parse(draft);
    for (const type of PUBLIC_FORM_TYPES) {
      expect(() => validateFormFields(config, [{ id: 'f', type }])).not.toThrow();
    }
    for (const type of ['user', 'link', 'expression', 'attachment', 'unknown']) {
      expect(() => validateFormFields(config, [{ id: 'f', type }])).toThrow(
        'Form field is unavailable',
      );
    }
    expect(() => validateFormFields(config, [])).toThrow('Form field is unavailable');
    expect(
      formConfigSchema.safeParse({ ...config, fields: [...config.fields, ...config.fields] })
        .success,
    ).toBe(false);
  });

  it('normalizes title and supplies exact public copy defaults', () => {
    expect(formConfigSchema.parse({ ...draft, title: ' Contact ' })).toEqual({
      ...draft,
      description: '',
      successMessage: 'Thank you. Your response has been received.',
    });
  });

  it('requires explicit fields and a required boolean per field', () => {
    for (const fields of [[], [{ fieldId: 'f' }], [{ fieldId: '', required: false }]]) {
      expect(formConfigSchema.safeParse({ ...draft, fields }).success).toBe(false);
    }
  });

  it('enforces text budgets and the 50-field projection budget', () => {
    const fields = Array.from({ length: 50 }, (_, i) => ({ fieldId: `f${i}`, required: false }));
    expect(
      formConfigSchema.safeParse({
        title: 'a'.repeat(120),
        description: 'a'.repeat(2000),
        successMessage: 'a'.repeat(500),
        fields,
      }).success,
    ).toBe(true);
    for (const patch of [
      { title: '' },
      { title: ' ' },
      { title: 'a'.repeat(121) },
      { description: 'a'.repeat(2001) },
      { successMessage: '' },
      { successMessage: 'a'.repeat(501) },
      { fields: [...fields, { fieldId: 'f50', required: false }] },
    ]) {
      expect(formConfigSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    }
  });
});
