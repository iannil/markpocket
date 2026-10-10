import { describe, expect, it } from 'vitest';

import {
  parseViewOptions,
  parseViewOptionsStrict,
  filterReferencesField,
  collectReferencedFieldIds,
  removeFieldReferences,
  viewOptionsSchema,
  FILTER_OPERATORS,
  VIEW_TYPES,
  type ViewOptions,
} from './view-ast';

function ok(options: unknown): void {
  const result = viewOptionsSchema.safeParse(options);
  expect(result.success).toBe(true);
}

function fails(options: unknown, messagePart: string): void {
  const result = viewOptionsSchema.safeParse(options);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.some((i) => i.message.includes(messagePart))).toBe(true);
  }
}

describe('viewOptionsSchema', () => {
  it('accepts an empty options object', () => {
    ok({});
  });

  it('accepts the shapes the UI writes', () => {
    ok({
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
      sort: [{ fieldId: 'f1', direction: 'asc' }],
      group: [{ fieldId: 'f2' }],
      hiddenFields: ['f3'],
      columnWidth: { f1: 120 },
    });
    expect(VIEW_TYPES).toContain('grid');
  });

  it('rejects an operator outside the whitelist', () => {
    fails(
      { filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'regex', operand: 'x' }] } },
      'Unsupported filter operator',
    );
    // Whitelist matches what compileFilter can actually compile.
    expect(FILTER_OPERATORS).not.toContain('regex');
  });

  it('rejects nesting deeper than 10 levels', () => {
    let node: unknown = { fieldId: 'f1', operator: 'equals', operand: 'x' };
    for (let i = 0; i < 11; i++) node = { op: 'and', conditions: [node] };
    fails({ filter: node }, 'nesting exceeds');
  });

  it('rejects more than 50 condition nodes', () => {
    const conditions = Array.from({ length: 51 }, () => ({
      fieldId: 'f1',
      operator: 'equals',
      operand: 'x',
    }));
    fails({ filter: { op: 'and', conditions } }, 'exceeds 50 conditions');
  });

  it('rejects operand strings longer than 1000 chars', () => {
    fails(
      {
        filter: {
          op: 'and',
          conditions: [{ fieldId: 'f1', operator: 'contains', operand: 'x'.repeat(1001) }],
        },
      },
      'operand must be a scalar',
    );
  });

  it('rejects non-scalar operands', () => {
    fails(
      {
        filter: {
          op: 'and',
          conditions: [{ fieldId: 'f1', operator: 'equals', operand: { evil: 1 } }],
        },
      },
      'operand must be a scalar',
    );
  });

  it('rejects unknown group ops', () => {
    fails(
      { filter: { op: 'xor', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] } },
      '"and" or "or"',
    );
  });

  it('caps sort entries at 20', () => {
    fails(
      { sort: Array.from({ length: 21 }, () => ({ fieldId: 'f1', direction: 'asc' as const })) },
      '20',
    );
  });

  it('caps hiddenFields at 200', () => {
    fails({ hiddenFields: Array.from({ length: 201 }, () => 'f') }, '200');
  });

  it('caps the serialized size at 64KB', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) wide[`column_${'_'.repeat(20)}${i}`] = 1234567890;
    fails({ columnWidth: wide }, 'exceed 64KB serialized');
  });
});

describe('parseViewOptions — back-compat', () => {
  it('returns {} for non-object raw values', () => {
    expect(parseViewOptions(null)).toEqual({});
    expect(parseViewOptions('nope')).toEqual({});
    expect(parseViewOptions(undefined)).toEqual({});
  });

  it('returns the parsed options for valid stored rows', () => {
    const options = { hiddenFields: ['f1'], sort: [{ fieldId: 'f2', direction: 'desc' }] };
    expect(parseViewOptions(options)).toEqual(options);
  });

  it('degrades legacy rows that fail validation to {} instead of throwing', () => {
    expect(
      parseViewOptions({ filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'wat' }] } }),
    ).toEqual({});
  });
});

describe('parseViewOptionsStrict — public share path (review M-1)', () => {
  it('returns the parsed options for valid stored rows', () => {
    const options = { hiddenFields: ['f1'], sort: [{ fieldId: 'f2', direction: 'desc' }] };
    expect(parseViewOptionsStrict(options)).toEqual(options);
  });

  it('accepts an empty options object (a view with no options legitimately shares its table)', () => {
    expect(parseViewOptionsStrict({})).toEqual({});
  });

  it('returns null for non-object raw values', () => {
    expect(parseViewOptionsStrict(null)).toBeNull();
    expect(parseViewOptionsStrict('nope')).toBeNull();
    expect(parseViewOptionsStrict(undefined)).toBeNull();
  });

  it('returns null — never {} — for legacy rows the current schema rejects', () => {
    // Operand longer than the current 1000-char cap: valid when written,
    // rejected today. The tolerant variant degrades to {}; the strict variant
    // must invalidate the share instead of widening it to the full table.
    expect(
      parseViewOptionsStrict({
        hiddenFields: ['f2'],
        filter: {
          op: 'and',
          conditions: [{ fieldId: 'f2', operator: 'equals', operand: 'x'.repeat(1001) }],
        },
      }),
    ).toBeNull();
    expect(
      parseViewOptionsStrict({
        filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'wat' }] },
      }),
    ).toBeNull();
  });
});

describe('filterReferencesField', () => {
  const tree = {
    op: 'or' as const,
    conditions: [
      { fieldId: 'f1', operator: 'equals' as const, operand: 'x' },
      {
        op: 'and' as const,
        conditions: [{ fieldId: 'f2', operator: 'empty' }],
      },
    ],
  };

  it('finds references at the top level and nested in groups', () => {
    expect(filterReferencesField(tree, 'f1')).toBe(true);
    expect(filterReferencesField(tree, 'f2')).toBe(true);
  });

  it('returns false for absent fields and undefined filters', () => {
    expect(filterReferencesField(tree, 'f3')).toBe(false);
    expect(filterReferencesField(undefined, 'f1')).toBe(false);
  });
});

describe('collectReferencedFieldIds — liveness gate input (review N4)', () => {
  it('collects fieldIds from filter conditions, including nested groups', () => {
    const options: ViewOptions = {
      filter: {
        op: 'or',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'x' },
          {
            op: 'and',
            conditions: [
              { fieldId: 'f2', operator: 'empty' },
              { op: 'or', conditions: [{ fieldId: 'f3', operator: 'notEmpty' }] },
            ],
          },
        ],
      },
    };
    expect(collectReferencedFieldIds(options)).toEqual(new Set(['f1', 'f2', 'f3']));
  });

  it('collects sort, group and hiddenFields ids alongside filter ids', () => {
    const options: ViewOptions = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'empty' }] },
      sort: [{ fieldId: 'f2', direction: 'asc' }],
      group: [{ fieldId: 'f3' }],
      hiddenFields: ['f4'],
    };
    expect(collectReferencedFieldIds(options)).toEqual(new Set(['f1', 'f2', 'f3', 'f4']));
  });

  it('deduplicates ids referenced by multiple keys', () => {
    const options: ViewOptions = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'empty' }] },
      sort: [{ fieldId: 'f1', direction: 'asc' }],
      hiddenFields: ['f1'],
    };
    expect(collectReferencedFieldIds(options)).toEqual(new Set(['f1']));
  });

  it('ignores columnWidth keys — UI metadata the cleanup deliberately leaves stale', () => {
    const options: ViewOptions = { columnWidth: { f1: 120, 'f-gone': 80 } };
    expect(collectReferencedFieldIds(options)).toEqual(new Set());
  });

  it('returns an empty set for empty options', () => {
    expect(collectReferencedFieldIds({})).toEqual(new Set());
  });
});

describe('removeFieldReferences — field.delete cleanup (review M-2)', () => {
  it('returns the same object when nothing references the field', () => {
    const options: ViewOptions = { hiddenFields: ['f-other'] };
    expect(removeFieldReferences(options, 'f-gone')).toBe(options);
  });

  it('prunes a nested condition and keeps the surviving group structure', () => {
    const options: ViewOptions = {
      filter: {
        op: 'or',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'x' },
          { op: 'and', conditions: [{ fieldId: 'f2', operator: 'empty' }] },
        ],
      },
    };
    expect(removeFieldReferences(options, 'f2')).toEqual({
      filter: { op: 'or', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
    });
  });

  it('drops a group that empties out entirely', () => {
    const options: ViewOptions = {
      filter: {
        op: 'and',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'x' },
          { op: 'or', conditions: [{ fieldId: 'f2', operator: 'empty' }] },
        ],
      },
    };
    expect(removeFieldReferences(options, 'f2')).toEqual({
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
    });
  });

  it('removes the filter key when the root group empties (single-condition group)', () => {
    const options: ViewOptions = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'empty' }] },
    };
    expect(removeFieldReferences(options, 'f1')).toEqual({});
  });

  it('strips sort, group and hiddenFields references, dropping emptied arrays', () => {
    const options: ViewOptions = {
      sort: [
        { fieldId: 'f1', direction: 'asc' },
        { fieldId: 'f2', direction: 'desc' },
      ],
      group: [{ fieldId: 'f1' }],
      hiddenFields: ['f1', 'f3'],
      columnWidth: { f1: 120, f2: 80 },
    };
    expect(removeFieldReferences(options, 'f1')).toEqual({
      sort: [{ fieldId: 'f2', direction: 'desc' }],
      hiddenFields: ['f3'],
      // columnWidth is UI metadata — stale keys are left alone.
      columnWidth: { f1: 120, f2: 80 },
    });
  });

  it('drops sort/group/hiddenFields keys when every entry referenced the field', () => {
    const options: ViewOptions = {
      sort: [{ fieldId: 'f1', direction: 'asc' }],
      group: [{ fieldId: 'f1' }],
      hiddenFields: ['f1'],
    };
    expect(removeFieldReferences(options, 'f1')).toEqual({});
  });

  it('produces options that still satisfy viewOptionsSchema', () => {
    const options: ViewOptions = {
      filter: {
        op: 'and',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'keep' },
          { fieldId: 'f-gone', operator: 'contains', operand: 'drop' },
        ],
      },
      sort: [
        { fieldId: 'f-gone', direction: 'asc' },
        { fieldId: 'f2', direction: 'desc' },
      ],
      hiddenFields: ['f-gone'],
    };
    const cleaned = removeFieldReferences(options, 'f-gone');
    expect(viewOptionsSchema.safeParse(cleaned).success).toBe(true);
  });

  // The write gate (checkFilterNode) accepts a BARE condition as the filter
  // root — no wrapping group. The declared ViewOptions.filter type still says
  // FilterGroup, so these fixtures (runtime-legal stored shapes) need a cast.
  // The pruner used to iterate `.conditions` unconditionally, so a stored
  // bare-condition filter crashed field.delete with "conditions is not
  // iterable" and the field could never be removed.
  describe('bare-condition filter root', () => {
    it('removes the filter when the bare root references the field', () => {
      const options = {
        filter: { fieldId: 'f-gone', operator: 'equals', operand: 'x' },
      } as unknown as ViewOptions;
      expect(viewOptionsSchema.safeParse(options).success).toBe(true); // writable today
      expect(removeFieldReferences(options, 'f-gone')).toEqual({});
    });

    it('keeps the bare root untouched when it references another field', () => {
      const filter = { fieldId: 'f-keep', operator: 'equals' as const, operand: 'x' };
      const options = {
        filter,
        hiddenFields: ['f-gone'],
      } as unknown as ViewOptions;
      const cleaned = removeFieldReferences(options, 'f-gone');
      expect(cleaned.filter).toEqual(filter);
      expect(cleaned.hiddenFields).toBeUndefined();
    });

    it('still prunes group-nested children under a bare-root sibling path', () => {
      // 组内嵌套裸条件的命中路径已有覆盖（prunes a nested condition），这里
      // 补根为裸条件 + 其他键命中时的整体行为：filter 原样保留、其余键被清。
      const filter = { fieldId: 'f-keep', operator: 'empty' as const };
      const options = {
        filter,
        sort: [
          { fieldId: 'f-gone', direction: 'asc' },
          { fieldId: 'f2', direction: 'asc' },
        ],
      } as unknown as ViewOptions;
      expect(removeFieldReferences(options, 'f-gone')).toEqual({
        filter,
        sort: [{ fieldId: 'f2', direction: 'asc' }],
      });
    });
  });
});

describe('Form options and cleanup', () => {
  const form = {
    title: 'Contact',
    description: '',
    successMessage: 'Thanks',
    fields: [
      { fieldId: 'f1', required: true },
      { fieldId: 'f2', required: false },
    ],
  };
  it('parses valid form config without losing its projection', () => {
    expect(viewOptionsSchema.parse({ form })).toEqual({ form });
    expect(collectReferencedFieldIds({ form })).toEqual(new Set(['f1', 'f2']));
  });
  it('rejects empty saved form projections while allowing draft options', () => {
    expect(viewOptionsSchema.safeParse({ form: { ...form, fields: [] } }).success).toBe(false);
    expect(viewOptionsSchema.safeParse({}).success).toBe(true);
  });
  it('prunes form fields while preserving other config keys', () => {
    const options = { form, hiddenFields: ['f1'], kanban: { groupFieldId: 'other' } };
    expect(removeFieldReferences(options, 'f1')).toEqual({
      form: { ...form, fields: [{ fieldId: 'f2', required: false }] },
      kanban: options.kanban,
    });
  });
  it('keeps an emptied form invalid until reconfigured', () => {
    const options = { form: { ...form, fields: [{ fieldId: 'f1', required: true }] } };
    const pruned = removeFieldReferences(options, 'f1');
    expect(pruned.form?.fields).toEqual([]);
    expect(viewOptionsSchema.safeParse(pruned).success).toBe(false);
  });
});

describe('Kanban options', () => {
  it('supports Kanban and collects both references', () => {
    const kanban = { groupFieldId: 'status', titleFieldId: 'title' };
    expect(VIEW_TYPES).toContain('kanban');
    expect(viewOptionsSchema.parse({ kanban })).toEqual({ kanban });
    expect(collectReferencedFieldIds({ kanban })).toEqual(new Set(['status', 'title']));
    expect(collectReferencedFieldIds({ kanban: { groupFieldId: 'status' } })).toEqual(
      new Set(['status']),
    );
  });
  it('rejects incomplete configuration and retains stale references for fail-closed reads', () => {
    for (const kanban of [{}, { groupFieldId: '' }, { groupFieldId: 'status', titleFieldId: '' }])
      expect(viewOptionsSchema.safeParse({ kanban }).success).toBe(false);
    const options = {
      kanban: { groupFieldId: 'status' },
      hiddenFields: ['status'],
      extension: { keep: true },
    };
    expect(removeFieldReferences(options, 'status')).toEqual({
      kanban: options.kanban,
      extension: options.extension,
    });
  });
});
