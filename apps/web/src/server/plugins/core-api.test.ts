import { describe, expect, it, vi } from 'vitest';

// @/server/db 在 import 时会尝试建立 pg 连接；测试里打桩以避免真实连接。
// sql.notify 是 realtime/publish.ts 的依赖（emit 内部使用），一并打桩。
vi.mock('@/server/db', () => ({ db: {}, sql: { notify: vi.fn() } }));

import { coreServerApi } from './core-api';
import { materializeExpressionsForRecord } from '@/server/expression';
import { publishTableChange } from '@/server/realtime/publish';

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

  it('injects the real expression materializer (ADR-0003 via plugins)', () => {
    // Plugins that write records (CSV import) must land on the same
    // materialization path as the core record router.
    expect(coreServerApi.queries.materializeExpressionsForRecord).toBe(
      materializeExpressionsForRecord,
    );
  });

  it('injects registry-dispatched normalizeCellValue', () => {
    expect(typeof coreServerApi.fieldTypes.normalizeCellValue).toBe('function');
  });

  it('injects the real realtime publisher (ADR-0002 via plugins)', () => {
    // Plugin writes (CSV import) must broadcast through the same
    // LISTEN/NOTIFY path the core routers use — not a plugin-side fork.
    expect(coreServerApi.realtime.publishTableChange).toBe(publishTableChange);
  });
});
