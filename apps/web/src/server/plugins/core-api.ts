import type { CoreServerApi } from '@markpocket/plugin-sdk';

import { cell, field, record, table } from '@/server/db/schema';
import { db } from '@/server/db';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { listRecordsPivoted } from '@/lib/db-queries';

// app 侧组装注入给插件的核心服务。插件不 import @/，只收此对象。
export const coreServerApi: CoreServerApi = {
  db: db as CoreServerApi['db'],
  schema: { record, cell, field, table },
  queries: { listRecordsPivoted } as CoreServerApi['queries'],
  fieldTypes: { FieldType, formatNumberToString, parseStringToNumber },
};
