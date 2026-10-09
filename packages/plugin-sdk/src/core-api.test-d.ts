import { expectTypeOf, test } from 'vitest';

import type { CoreServerApi, ServerRouterFactory } from './index';

test('ServerRouterFactory receives CoreServerApi', () => {
  type F = ServerRouterFactory<{ ok: true }>;
  expectTypeOf<F>().parameter(0).toMatchTypeOf<CoreServerApi>();
});

test('CoreServerApi exposes queries.listRecordsPivoted', () => {
  expectTypeOf<CoreServerApi['queries']['listRecordsPivoted']>().toBeFunction();
});

test('CSV export preserves complete-only response contract', () => {
  expectTypeOf<CoreServerApi['exports']['tableCsv']>().parameters.toEqualTypeOf<[string, string]>();
  expectTypeOf<CoreServerApi['exports']['tableCsv']>().returns.toEqualTypeOf<
    Promise<{
      csv: string;
      exported: number;
      truncated: false;
    }>
  >();
});
