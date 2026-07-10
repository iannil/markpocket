import { expectTypeOf, test } from 'vitest';

import type { FieldTypeContribution, NormalizedCell } from './index';

test('FieldTypeContribution.normalizeCellValue returns NormalizedCell', () => {
  expectTypeOf<
    FieldTypeContribution['normalizeCellValue']
  >().returns.toEqualTypeOf<NormalizedCell>();
});

test('NormalizedCell is a discriminated union of empty/value/error', () => {
  expectTypeOf<NormalizedCell>().toEqualTypeOf<
    { empty: true } | { value: string | number | boolean | string[] } | { error: string }
  >();
});
