import { describe, expect, it, vi } from 'vitest';

// @/server/db 在 import 时会尝试建立 pg 连接；测试里打桩以避免真实连接。
vi.mock('@/server/db', () => ({ db: {} }));

import { coreServerApi } from './core-api';

describe('coreServerApi', () => {
  it('exposes db, schema tables, queries, fieldTypes', () => {
    expect(coreServerApi.db).toBeDefined();
    expect(coreServerApi.schema.record).toBeDefined();
    expect(coreServerApi.schema.cell).toBeDefined();
    expect(coreServerApi.schema.field).toBeDefined();
    expect(coreServerApi.schema.table).toBeDefined();
    expect(typeof coreServerApi.queries.listRecordsPivoted).toBe('function');
    expect(typeof coreServerApi.fieldTypes.parseStringToNumber).toBe('function');
    expect(coreServerApi.fieldTypes.FieldType.Number).toBe('number');
  });
});
