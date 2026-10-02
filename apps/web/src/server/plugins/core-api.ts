import type { CoreServerApi } from '@markpocket/plugin-sdk';

import { cell, cellHistory, field, record, table } from '@/server/db/schema';
import { db } from '@/server/db';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { listRecordsPivoted } from '@/lib/db-queries';
import { assertTableRole } from '@/lib/roles';
import { materializeExpressionsForRecord } from '@/server/expression';
import { publishTableChange } from '@/server/realtime/publish';
import { fieldTypeRegistry } from './registry';

// app 侧组装注入给插件的核心服务。插件不 import @/，只收此对象。
// auth.assertTableRole 让插件 router 与核心 router 走同一套角色门禁。
export const coreServerApi: CoreServerApi = {
  db: db as CoreServerApi['db'],
  schema: { record, cell, field, table, cellHistory },
  queries: {
    listRecordsPivoted,
    // ADR-0003/0008: writes from plugins go through the same materialization
    // path as the core record routers — the plugin passes its own tx handle.
    materializeExpressionsForRecord:
      materializeExpressionsForRecord as CoreServerApi['queries']['materializeExpressionsForRecord'],
  } as CoreServerApi['queries'],
  fieldTypes: {
    FieldType,
    formatNumberToString,
    parseStringToNumber,
    // Registry dispatch so plugins reuse core value semantics (ADR-0009)
    // instead of forking them per plugin.
    normalizeCellValue: (type, options, raw) =>
      fieldTypeRegistry.get(type).normalizeCellValue(options, raw),
  },
  auth: { assertTableRole },
  // ADR-0002: same injector pattern as db/auth — the app-side function is
  // handed in, so plugins broadcast through the identical LISTEN/NOTIFY path
  // the core routers use (same echo-suppression semantics included).
  realtime: { publishTableChange },
};
