# Plan 3a：服务端 Field Type 注册表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 field-types.ts 的值语义（`normalizeCellValue`/`parseOptions`/`defaultOptions`）从静态 switch 改为 `fieldTypeRegistry` 驱动的分发，10 个内建类型的 per-type 逻辑搬进核心捆绑模块 `server/plugins/builtin-fields/` 并 bootstrap 注册——为第三方字段类型（Plan 3b 的 Rating）打开服务端接缝，且 ADR-0005 值语义逐类型 parity 不变。

**Architecture:** 仅服务端。客户端只从 `field-types.ts` 用 `FieldType`/`SelectOption`/`FIELD_TYPE_META`/`FIELD_TYPES`（已核实，不调值语义函数），故这些留 `field-types.ts` 作纯数据；`normalizeCellValue`/`parseOptions`/`defaultOptions` 移到新的**服务端**模块 `server/plugins/field-value.ts`，经 `fieldTypeRegistry` 分发。10 内建类型的 `{optionsSchema, defaultOptions, normalizeCellValue, meta}` 逐字搬进 `server/plugins/builtin-fields/index.ts`，在 `server/plugins` barrel bootstrap 注册。写路径（cell.ts empty→删行策略）不变。

**Tech Stack:** TypeScript (ESM), pnpm workspace, Vitest, tRPC 11, Drizzle, zod 4。

## Global Constraints

- Node >=22；ESM；包不经构建。单引号、2 空格缩进；pre-commit 自动 prettier+eslint。
- 测试用相对/workspace 包名导入，不用 `@/` 别名（vitest 已配 `@` alias，但优先相对导入；导入 `@/server/db` 的测试须 `vi.mock('@/server/db')`，沿用既有模式）。
- **不改 ADR-0001~0005**：`cell.ts` 的 empty→删行 / error→拒 / value→存 JSONB 统一策略不动；只把 per-type「原始值→NormalizedCell」规约抽进注册表。
- **不含 client**（cell-renderers / field-config / picker 改造与 Rating 属 Plan 3b）。本计划零 UI 变化。
- `field-types.ts` 的客户端可见导出（`FieldType`、`FIELD_TYPES`、`selectOptionSchema`、`SelectOption`、`FIELD_TYPE_META`、`CellValue`/`NormalizedCell`/`FieldOptions` 类型）**签名不变**，客户端 import 不受影响。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: SDK 加 FieldTypeContribution + 共享值类型

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts`（追加导出）
- Test: `packages/plugin-sdk/src/field-type.test-d.ts`

**Interfaces:**
- Produces（from `@markpocket/plugin-sdk`）:
  - `type CellValue = string | number | boolean | string[]`
  - `type FieldOptions = Record<string, unknown>`
  - `type NormalizedCell = { empty: true } | { value: CellValue } | { error: string }`
  - `interface OptionsSchema { parse(raw: unknown): FieldOptions }`（结构化，避免 SDK 依赖 zod）
  - `interface FieldTypeContribution { type: string; optionsSchema: OptionsSchema; defaultOptions: () => FieldOptions; normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell; meta: { label: string; description: string } }`

- [ ] **Step 1: 追加到 `packages/plugin-sdk/src/index.ts`（不动已有导出）**

```ts
// --- Field Type 扩展点（server 侧值语义）---

export type CellValue = string | number | boolean | string[];
export type FieldOptions = Record<string, unknown>;
export type NormalizedCell = { empty: true } | { value: CellValue } | { error: string };

// 结构化 options 校验面：任何 zod object schema 的 .parse 结构上满足它，SDK 因此不依赖 zod。
export interface OptionsSchema {
  parse(raw: unknown): FieldOptions;
}

export interface FieldTypeContribution {
  type: string;
  optionsSchema: OptionsSchema;
  defaultOptions: () => FieldOptions;
  normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell;
  meta: { label: string; description: string };
}
```

- [ ] **Step 2: 类型测试 `packages/plugin-sdk/src/field-type.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest';

import type { FieldTypeContribution, NormalizedCell } from './index';

test('FieldTypeContribution.normalizeCellValue returns NormalizedCell', () => {
  expectTypeOf<FieldTypeContribution['normalizeCellValue']>().returns.toEqualTypeOf<NormalizedCell>();
});

test('NormalizedCell is a discriminated union of empty/value/error', () => {
  expectTypeOf<NormalizedCell>().toEqualTypeOf<
    { empty: true } | { value: string | number | boolean | string[] } | { error: string }
  >();
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm exec vitest run field-type`
Expected: PASS（类型测试；vitest typecheck 块已配，见 `vitest.config.ts`）。

- [ ] **Step 4: 全量不回归**

Run: `pnpm exec vitest run`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-sdk
git commit -m "feat(sdk): FieldTypeContribution + 共享 CellValue/NormalizedCell/FieldOptions

Field Type 扩展点的 server 侧契约：per-type optionsSchema(结构化)/defaultOptions/
normalizeCellValue/meta；共享值类型供核心与插件复用。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: builtin-fields 模块（10 内建 contribution）+ 逐类型 parity 测试

**Files:**
- Create: `apps/web/src/server/plugins/builtin-fields/index.ts`
- Test: `apps/web/src/server/plugins/builtin-fields/parity.test.ts`
- Modify: `apps/web/src/server/plugins/registry.ts`（`fieldTypeRegistry` 收紧类型）

**Interfaces:**
- Consumes: `FieldTypeContribution`, `NormalizedCell`, `FieldOptions`（Task 1）；`FieldType`, `selectOptionSchema`, `SelectOption`（`@/lib/field-types`，仍在）。
- Produces: `builtinFieldTypes: FieldTypeContribution[]`（10 个）；`registry.ts` 的 `fieldTypeRegistry: Registry<FieldTypeContribution>`。

- [ ] **Step 1: 收紧 `registry.ts` 的 fieldTypeRegistry 类型**

把 `apps/web/src/server/plugins/registry.ts` 里
`export const fieldTypeRegistry: Registry<unknown> = createRegistry('field type');`
改为：
```ts
import { createRegistry, type Registry, type StorageProvider, type FieldTypeContribution } from '@markpocket/plugin-sdk';
// ...
export const fieldTypeRegistry: Registry<FieldTypeContribution> = createRegistry('field type');
```
（合并进现有 import 行；其余注册表不动。）

- [ ] **Step 2: 建 `apps/web/src/server/plugins/builtin-fields/index.ts`（逐字搬 10 类型）**

把 `@/lib/field-types` 的 `optionsSchemas`（每类型的 zod schema）、`defaultOptions`（每类型分支）、`normalizeCellValue`（每类型 case）、`FIELD_TYPE_META`（每类型 label/description）**逐字**重组为每类型一个 `FieldTypeContribution`。完整代码：

```ts
import { z } from 'zod';

import type { FieldTypeContribution, FieldOptions, NormalizedCell } from '@markpocket/plugin-sdk';
import { FieldType, selectOptionSchema, type SelectOption } from '@/lib/field-types';

const text: FieldTypeContribution = {
  type: FieldType.Text,
  optionsSchema: z.object({}),
  defaultOptions: () => ({}),
  meta: { label: 'Text', description: 'Single-line text' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const s = typeof raw === 'string' ? raw : String(raw);
    return s === '' ? { empty: true } : { value: s };
  },
};

const number: FieldTypeContribution = {
  type: FieldType.Number,
  optionsSchema: z.object({
    precision: z.number().int().min(0).max(10).optional(),
    scale: z.number().int().min(0).max(10).optional(),
  }),
  defaultOptions: () => ({ precision: 0 }),
  meta: { label: 'Number', description: 'Numeric value' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isNaN(n) ? { error: 'Invalid number' } : { value: n };
  },
};

const boolean: FieldTypeContribution = {
  type: FieldType.Boolean,
  optionsSchema: z.object({}),
  defaultOptions: () => ({}),
  meta: { label: 'Checkbox', description: 'True / false' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    if (typeof raw === 'boolean') return { value: raw };
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'Invalid boolean' };
  },
};

const date: FieldTypeContribution = {
  type: FieldType.Date,
  optionsSchema: z.object({ includeTime: z.boolean().optional() }),
  defaultOptions: () => ({ includeTime: false }),
  meta: { label: 'Date', description: 'Date or datetime' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const s = String(raw);
    return Number.isNaN(Date.parse(s)) ? { error: 'Invalid date' } : { value: s };
  },
};

const singleSelect: FieldTypeContribution = {
  type: FieldType.SingleSelect,
  optionsSchema: z.object({ choices: z.array(selectOptionSchema) }),
  defaultOptions: () => ({ choices: [] as SelectOption[] }),
  meta: { label: 'Select', description: 'Pick one from options' },
  normalizeCellValue: (options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    const id = String(raw);
    const choices = (options.choices as SelectOption[] | undefined) ?? [];
    return choices.some((c) => c.id === id) ? { value: id } : { error: 'Unknown select option' };
  },
};

const expression: FieldTypeContribution = {
  type: FieldType.Expression,
  optionsSchema: z.object({ expression: z.string(), dependsOn: z.array(z.string()) }),
  defaultOptions: () => ({ expression: '', dependsOn: [] }),
  meta: { label: 'Expression', description: 'Computed from other fields' },
  normalizeCellValue: () => ({ error: 'Expression fields are computed, not user-editable' }),
};

const multiSelect: FieldTypeContribution = {
  type: FieldType.MultiSelect,
  optionsSchema: z.object({ choices: z.array(selectOptionSchema) }),
  defaultOptions: () => ({ choices: [] as SelectOption[] }),
  meta: { label: 'Multi-Select', description: 'Pick multiple from options' },
  normalizeCellValue: (options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
    if (arr.length === 0) return { empty: true };
    const choices = (options.choices as SelectOption[] | undefined) ?? [];
    if (!arr.every((id) => choices.some((c) => c.id === id))) {
      return { error: 'Unknown select option' };
    }
    return { value: arr };
  },
};

const user: FieldTypeContribution = {
  type: FieldType.User,
  optionsSchema: z.object({}),
  defaultOptions: () => ({}),
  meta: { label: 'User', description: 'Reference to a user' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null || raw === '') return { empty: true };
    return { value: String(raw) };
  },
};

const link: FieldTypeContribution = {
  type: FieldType.Link,
  optionsSchema: z.object({ targetTableId: z.string() }),
  defaultOptions: () => ({ targetTableId: '' }),
  meta: { label: 'Link', description: 'Link to another table' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
    if (arr.length === 0) return { empty: true };
    return { value: arr };
  },
};

const attachment: FieldTypeContribution = {
  type: FieldType.Attachment,
  optionsSchema: z.object({}),
  defaultOptions: () => ({}),
  meta: { label: 'Attachment', description: 'File upload' },
  normalizeCellValue: (_options, raw) => {
    if (raw == null) return { empty: true };
    const arr = Array.isArray(raw) ? raw.map(String) : raw === '' ? [] : [String(raw)];
    if (arr.length === 0) return { empty: true };
    return { value: arr };
  },
};

export const builtinFieldTypes: FieldTypeContribution[] = [
  text,
  number,
  boolean,
  date,
  singleSelect,
  expression,
  multiSelect,
  user,
  link,
  attachment,
];
```

> `optionsSchema: z.object(...)` 赋给 `OptionsSchema` 结构面：zod object 的 `.parse` 返回类型（如 `{precision?:number}`）对 `FieldOptions=Record<string,unknown>` 若报 excess/index 摩擦，用 `as unknown as OptionsSchema` 或 `satisfies` 落地，并在 report 说明。运行时行为不变。

- [ ] **Step 3: 写 parity 测试 `apps/web/src/server/plugins/builtin-fields/parity.test.ts`（对字面量断言，独立于旧实现）**

```ts
import { describe, expect, it } from 'vitest';

import { builtinFieldTypes } from './index';

const byType = Object.fromEntries(builtinFieldTypes.map((c) => [c.type, c]));

describe('builtin field types — normalizeCellValue parity', () => {
  it('text: empty on null/empty-string, value otherwise', () => {
    expect(byType['text'].normalizeCellValue({}, null)).toEqual({ empty: true });
    expect(byType['text'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['text'].normalizeCellValue({}, 'hi')).toEqual({ value: 'hi' });
  });
  it('number: empty/error/value', () => {
    expect(byType['number'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['number'].normalizeCellValue({}, 'abc')).toEqual({ error: 'Invalid number' });
    expect(byType['number'].normalizeCellValue({}, '3.5')).toEqual({ value: 3.5 });
    expect(byType['number'].normalizeCellValue({}, 4)).toEqual({ value: 4 });
  });
  it('boolean: bool/string/error', () => {
    expect(byType['boolean'].normalizeCellValue({}, null)).toEqual({ empty: true });
    expect(byType['boolean'].normalizeCellValue({}, true)).toEqual({ value: true });
    expect(byType['boolean'].normalizeCellValue({}, 'false')).toEqual({ value: false });
    expect(byType['boolean'].normalizeCellValue({}, 'x')).toEqual({ error: 'Invalid boolean' });
  });
  it('date: parse-based', () => {
    expect(byType['date'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['date'].normalizeCellValue({}, 'not-a-date')).toEqual({ error: 'Invalid date' });
    expect(byType['date'].normalizeCellValue({}, '2026-07-10')).toEqual({ value: '2026-07-10' });
  });
  it('single-select: membership by option id', () => {
    const opts = { choices: [{ id: 'o1', name: 'A', color: 'red' }] };
    expect(byType['single-select'].normalizeCellValue(opts, '')).toEqual({ empty: true });
    expect(byType['single-select'].normalizeCellValue(opts, 'o1')).toEqual({ value: 'o1' });
    expect(byType['single-select'].normalizeCellValue(opts, 'zz')).toEqual({
      error: 'Unknown select option',
    });
  });
  it('expression: always error (computed)', () => {
    expect(byType['expression'].normalizeCellValue({}, '1')).toEqual({
      error: 'Expression fields are computed, not user-editable',
    });
  });
  it('multi-select: array membership', () => {
    const opts = { choices: [{ id: 'o1', name: 'A', color: 'red' }] };
    expect(byType['multi-select'].normalizeCellValue(opts, [])).toEqual({ empty: true });
    expect(byType['multi-select'].normalizeCellValue(opts, ['o1'])).toEqual({ value: ['o1'] });
    expect(byType['multi-select'].normalizeCellValue(opts, ['zz'])).toEqual({
      error: 'Unknown select option',
    });
  });
  it('user: string id', () => {
    expect(byType['user'].normalizeCellValue({}, '')).toEqual({ empty: true });
    expect(byType['user'].normalizeCellValue({}, 'u1')).toEqual({ value: 'u1' });
  });
  it('link: id array', () => {
    expect(byType['link'].normalizeCellValue({}, [])).toEqual({ empty: true });
    expect(byType['link'].normalizeCellValue({}, ['r1', 'r2'])).toEqual({ value: ['r1', 'r2'] });
  });
  it('attachment: id array', () => {
    expect(byType['attachment'].normalizeCellValue({}, [])).toEqual({ empty: true });
    expect(byType['attachment'].normalizeCellValue({}, ['a1'])).toEqual({ value: ['a1'] });
  });
});

describe('builtin field types — defaultOptions parity', () => {
  it('matches known defaults', () => {
    expect(byType['number'].defaultOptions()).toEqual({ precision: 0 });
    expect(byType['date'].defaultOptions()).toEqual({ includeTime: false });
    expect(byType['single-select'].defaultOptions()).toEqual({ choices: [] });
    expect(byType['expression'].defaultOptions()).toEqual({ expression: '', dependsOn: [] });
    expect(byType['link'].defaultOptions()).toEqual({ targetTableId: '' });
    expect(byType['text'].defaultOptions()).toEqual({});
  });
});

describe('builtin field types — optionsSchema parity', () => {
  it('number rejects out-of-range precision', () => {
    expect(() => byType['number'].optionsSchema.parse({ precision: 99 })).toThrow();
  });
  it('number accepts empty options', () => {
    expect(byType['number'].optionsSchema.parse({})).toEqual({});
  });
  it('all 10 builtin types present', () => {
    expect(builtinFieldTypes).toHaveLength(10);
  });
});
```

- [ ] **Step 4: 跑测试确认失败→通过**

Run: `pnpm exec vitest run parity`
Expected: 先 FAIL（`./index` 未建时）→ 建好后 PASS（全部断言）。若 Step 2 已建好，直接跑应 PASS。

- [ ] **Step 5: 全量不回归 + typecheck**

Run: `pnpm exec vitest run`（全绿）；`pnpm --filter @markpocket/web typecheck`（exit 0）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/server/plugins
git commit -m "feat(fields): builtin-fields 模块 —— 10 内建 FieldTypeContribution + parity 测试

逐字搬 field-types.ts 的 optionsSchema/defaultOptions/normalizeCellValue/meta
为每类型一个 contribution；fieldTypeRegistry 收紧为 Registry<FieldTypeContribution>；
逐类型 parity 测试（empty/value/error 三态 + 越界 + 未知 option）兜底 ADR-0005。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 分发切换 —— field-value.ts + bootstrap 注册 + rewire routers + 清理 field-types.ts

**Files:**
- Create: `apps/web/src/server/plugins/field-value.ts`
- Modify: `apps/web/src/server/plugins/index.ts`（bootstrap 注册内建）
- Modify: `apps/web/src/server/trpc/routers/cell.ts`（import 改源）
- Modify: `apps/web/src/server/trpc/routers/field.ts`（import 改源）
- Modify: `apps/web/src/lib/field-types.ts`（删除已搬走的 per-type 逻辑，保留客户端可见数据/类型）
- Test: `apps/web/src/server/plugins/field-value.test.ts`

**Interfaces:**
- Consumes: `fieldTypeRegistry`（Task 2）、`builtinFieldTypes`（Task 2）、`FieldType`/`FieldOptions`/`NormalizedCell`（`@/lib/field-types` 仍导出类型 + FieldType const）。
- Produces（from `@/server/plugins/field-value`）:
  - `parseOptions(type: string, raw: unknown): FieldOptions`
  - `defaultOptions(type: string): FieldOptions`
  - `normalizeCellValue(type: string, options: FieldOptions, raw: unknown): NormalizedCell`

- [ ] **Step 1: bootstrap 注册内建（`server/plugins/index.ts`）**

在 `loadPlugins(plugins)` 之后追加内建注册：
```ts
import { loadPlugins } from './loader';
import { builtinFieldTypes } from './builtin-fields';
import { fieldTypeRegistry } from './registry';
import { plugins } from '@/plugins.config';

loadPlugins(plugins);

// 内建字段类型是「核心自带」，直接注册（不经 plugins.config 插件清单）。
for (const c of builtinFieldTypes) fieldTypeRegistry.register(c.type, c);

export { getStorage } from './storage';
export * from './registry';
```

- [ ] **Step 2: 写失败测试 `apps/web/src/server/plugins/field-value.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));

import { defaultOptions, normalizeCellValue, parseOptions } from './field-value';
import '@/server/plugins'; // barrel side-effect: registers builtin field types

describe('field-value dispatch', () => {
  it('normalizeCellValue dispatches to the registered type', () => {
    expect(normalizeCellValue('number', {}, '3')).toEqual({ value: 3 });
    expect(normalizeCellValue('text', {}, '')).toEqual({ empty: true });
  });
  it('parseOptions validates via the type schema', () => {
    expect(parseOptions('number', { precision: 2 })).toEqual({ precision: 2 });
    expect(() => parseOptions('number', { precision: 99 })).toThrow();
  });
  it('defaultOptions returns the type default', () => {
    expect(defaultOptions('date')).toEqual({ includeTime: false });
  });
  it('unknown type throws with a helpful message', () => {
    expect(() => normalizeCellValue('nope', {}, 'x')).toThrow(/Unknown field type "nope"/);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run field-value`
Expected: FAIL（`./field-value` 未建）。

- [ ] **Step 4: 实现 `apps/web/src/server/plugins/field-value.ts`**

```ts
import type { FieldOptions, NormalizedCell } from '@markpocket/plugin-sdk';

import { fieldTypeRegistry } from './registry';

// 服务端值语义分发。注册表由 server/plugins barrel 在首次 import 时填充
// （内建 + 插件贡献）。核心写路径经这些函数施加 ADR-0005 策略（empty/error/value）。
export function parseOptions(type: string, raw: unknown): FieldOptions {
  return fieldTypeRegistry.get(type).optionsSchema.parse(raw ?? {});
}

export function defaultOptions(type: string): FieldOptions {
  return fieldTypeRegistry.get(type).defaultOptions();
}

export function normalizeCellValue(
  type: string,
  options: FieldOptions,
  raw: unknown,
): NormalizedCell {
  return fieldTypeRegistry.get(type).normalizeCellValue(options, raw);
}
```

> `createRegistry.get` 对未知名字抛 `Unknown field type "x". Registered: ...`（`createRegistry('field type')` 的 kind 即 'field type'）。测试的 `/Unknown field type "nope"/` 据此。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run field-value`
Expected: PASS（4 用例）。

- [ ] **Step 6: rewire `cell.ts`**

`apps/web/src/server/trpc/routers/cell.ts`：
- 把 `import { FieldType, FieldOptions, normalizeCellValue } from '@/lib/field-types';`
  改为两行：
  ```ts
  import { FieldType, type FieldOptions } from '@/lib/field-types';
  import { normalizeCellValue } from '@/server/plugins/field-value';
  ```
- `normalizeCellValue(fld.type as FieldType, ...)` 调用处：现签名 `normalizeCellValue(type, options, raw)` 不变（field-value 版同签名），但第一参数类型现在是 `string`；`fld.type as FieldType` 可保留（FieldType 是 string 子类型，赋给 string 参数 OK）或简化为 `fld.type`。保持调用不变即可。
- `eq(field.type, FieldType.Expression)` 用的 `FieldType.Expression` const 仍从 `@/lib/field-types` 来，不变。

- [ ] **Step 7: rewire `field.ts`**

`apps/web/src/server/trpc/routers/field.ts`：
- 把
  ```ts
  import { FIELD_TYPES, FieldType, ...defaultOptions, parseOptions } from '@/lib/field-types';
  ```
  拆为：`FIELD_TYPES`/`FieldType`/`FieldOptions` 仍从 `@/lib/field-types`；`defaultOptions`/`parseOptions` 改从 `@/server/plugins/field-value`：
  ```ts
  import { FIELD_TYPES, FieldType, type FieldOptions } from '@/lib/field-types';
  import { defaultOptions, parseOptions } from '@/server/plugins/field-value';
  ```
- 调用 `parseOptions(input.type, ...)` / `defaultOptions(input.type)` 不变。`z.enum(FIELD_TYPES)` 仍用 const（Plan 3a 不加新类型；registry-driven 的 create 校验属 Plan 3b）。

- [ ] **Step 8: 清理 `apps/web/src/lib/field-types.ts`（删已搬走的 per-type 逻辑）**

删除 `optionsSchemas` 常量、`parseOptions` 函数、`defaultOptions` 函数、`normalizeCellValue` 函数（这四块已搬进 builtin-fields + field-value）。**保留**：`FieldType`、`FIELD_TYPES`、`selectOptionSchema`、`SelectOption`、`FieldOptions`、`CellValue`、`NormalizedCell`（类型可改为 `export type ... from '@markpocket/plugin-sdk'` 的 re-export，或保留本地定义——保留本地定义更省改动，二者等价，实现者择一并保证客户端 import 不变）、`FIELD_TYPE_META`。删除后确认 `z` import 若仅 `selectOptionSchema` 用则保留、否则按 eslint 清理。

- [ ] **Step 9: 校验无残留 + 全量 + typecheck**

Run: `grep -rn "from '@/lib/field-types'" apps/web/src | grep -E "parseOptions|defaultOptions|normalizeCellValue"` — Expected: 无输出（这三个不再从 field-types 导入）。
Run: `pnpm exec vitest run` — Expected: 全绿（parity + field-value + 既有）。
Run: `pnpm --filter @markpocket/web typecheck` — Expected: exit 0（cell/field/record routers + 客户端消费方全通）。

- [ ] **Step 10: 提交**

```bash
git add apps/web
git commit -m "refactor(fields): 值语义改注册表分发 —— field-value + bootstrap 注册内建

新增 server/plugins/field-value.ts（parseOptions/defaultOptions/normalizeCellValue
经 fieldTypeRegistry 分发）；barrel bootstrap 注册 10 内建类型；cell/field routers
改从 field-value 取；field-types.ts 删除已搬走的 per-type 逻辑，仅留客户端可见
数据/类型。写路径 ADR-0005 策略不变。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ADR-0009

**Files:**
- Create: `docs/adr/0009-field-type-registry.md`

- [ ] **Step 1: 写 ADR-0009**

按仓库 ADR 体例记录：(1) Field Type 从静态 switch 改注册表分发；(2) per-type 值语义（normalizeCellValue/optionsSchema/defaultOptions）进 `FieldTypeContribution`，ADR-0005 策略（empty→删行/级联）留核心写路径；(3) 内建 10 类型搬进核心捆绑模块 `server/plugins/builtin-fields/`（不物理搬包）bootstrap 注册；(4) 客户端可见数据（FieldType/FIELD_TYPE_META/SelectOption）留 `field-types.ts` 纯净，值语义分发是服务端 `field-value.ts`；(5) client 渲染器注册表与 Rating 属 Plan 3b。备选：全搬进包（否决，churn 大）、dispatch 留 field-types.ts（否决，会把 server registry 拖进 client bundle）。反悔代价低。

```markdown
# ADR-0009：Field Type 注册表（服务端值语义）

- **状态**：Accepted
- **日期**：2026-07-10
- **相关**：落地 `2026-07-10-field-type-extension-point-design.md`（Plan 3a）；受 ADR-0005 约束；延续 ADR-0007（注册表）/0008（server/client 拆分）

## 背景

`field-types.ts` 用静态 switch 写死 10 个字段类型的 optionsSchema / defaultOptions /
normalizeCellValue。第三方要加字段类型必须改核心源码。且该文件被 client 与 server
同时 import，值语义与 UI 数据混在一起。

## 决策

1. **值语义进注册表**：每类型的 `optionsSchema / defaultOptions / normalizeCellValue /
   meta` 收进 `FieldTypeContribution`（SDK 定义），存 `fieldTypeRegistry`。
2. **ADR-0005 策略留核心**：`cell.ts` 写路径消费 `NormalizedCell` 施加 empty→删行 /
   error→拒 / value→存 JSONB 的统一策略——不变；插件只提供 per-type「原始值→NormalizedCell」。
3. **内建留核心、不搬包**：10 内建类型的 contribution 住 `server/plugins/builtin-fields/`，
   barrel bootstrap 直接注册（核心自带，不经 plugins.config 插件清单）。
4. **client/server 分离**：`field-types.ts` 只留客户端可见数据（FieldType const、
   FIELD_TYPE_META、selectOptionSchema、类型）；值语义分发移到服务端 `field-value.ts`，
   避免把 server 注册表拖进 client bundle。

## 后果

正面：第三方可加字段类型（Plan 3b Rating 证明）；ADR-0005 值语义有逐类型 parity 护栏；
client bundle 不含 server 注册表。
负面：值语义分发依赖 barrel bootstrap 已注册内建；`FieldType` const 与注册表并存
（const 为内建目录，运行时以注册表为准）——create 校验仍用 const，registry-driven 校验待 Plan 3b。

## 备选方案

- 全 10 类型物理搬进 `plugin-builtin-fields` 包：churn 大、动已完成 v1 写路径过深。否决。
- dispatch 留 `field-types.ts`：会把 server 注册表 import 进 client bundle。否决——移到 field-value.ts。

## 反悔代价

低。分发是加法层，回退＝把 field-value 三函数改回 field-types.ts 的 switch。
```

- [ ] **Step 2: 提交**

```bash
git add docs/adr/0009-field-type-registry.md
git commit -m "docs(adr): ADR-0009 Field Type 注册表（服务端值语义）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（对 `2026-07-10-field-type-extension-point-design.md` 的 Plan 3a 部分）**：
- §2 拆分边界（FieldType const 留、值语义进注册表、ADR-0005 策略留核心）→ Task 2（contribution）+ Task 3（field-value 分发 + cell.ts 策略不动）。✅
- §3 服务端注册表（SDK FieldTypeContribution、fieldTypeRegistry 收紧、builtin-fields 模块、消费方改造）→ Task 1 + Task 2 + Task 3。✅
- §6 Plan 3a 范围（无 UI、parity 兜底、可独立合并）→ 全计划仅 server；Task 2 parity 测试。✅
- §7 测试（逐类型 parity、注册表单测、类型）→ Task 2 parity（10 类型三态）+ Task 3 field-value dispatch 测 + typecheck。✅
- §8 风险（写路径回归、FieldType 消费遗漏、expression 特殊）→ parity 测试 + Step 9 grep 校验 + expression contribution 原样保留 error。✅
- §9 ADR-0009 → Task 4。✅
- **不含 client**（§4 渲染器 / Rating）→ 明确属 Plan 3b，本计划零 UI。✅

**Placeholder scan**：无 TBD/TODO；每代码步含完整代码；parity 测试含逐类型断言字面量；ADR-0009 全文给出。✅

**Type consistency**：`FieldTypeContribution`（Task 1）↔ `builtinFieldTypes: FieldTypeContribution[]`（Task 2）↔ `fieldTypeRegistry: Registry<FieldTypeContribution>`（Task 2）↔ `field-value` 三函数 get 后调 `.optionsSchema.parse`/`.defaultOptions()`/`.normalizeCellValue()`（Task 3）。`normalizeCellValue(options, raw)` 的参数序（options 先、raw 后）在 contribution 与 field-value dispatch 一致；注意与旧 `field-types.ts` 的 `normalizeCellValue(type, options, raw)` 相比，新 contribution 版是 `(options, raw)`（type 已由 get 选中），field-value 对外仍是 `(type, options, raw)`——一致。✅
