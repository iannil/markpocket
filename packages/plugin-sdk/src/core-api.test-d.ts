import { expectTypeOf, test } from 'vitest';

import type { CoreServerApi, ServerRouterFactory } from './index';

test('ServerRouterFactory receives CoreServerApi', () => {
  type F = ServerRouterFactory<{ ok: true }>;
  expectTypeOf<F>().parameter(0).toMatchTypeOf<CoreServerApi>();
});

test('CoreServerApi exposes queries.listRecordsPivoted', () => {
  expectTypeOf<CoreServerApi['queries']['listRecordsPivoted']>().toBeFunction();
});
