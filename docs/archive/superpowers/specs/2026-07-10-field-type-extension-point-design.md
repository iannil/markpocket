# Field Type 扩展点设计（Plan 3）

> **日期**：2026-07-10
> **状态**：设计稿（待审阅）
> **相关**：延续 `2026-07-09-plugin-architecture-design.md` §4/§6 步骤 4；建立在 Plan 1（加载器/注册表，ADR-0007）与 Plan 2（CoreServerApi 注入 + server/client 拆分，ADR-0008）之上。**受 ADR-0005 强约束**（row-per-cell 值语义、empty=删行、级联清空）。

---

## 1. 已确认决策

| 决策 | 选择 |
|---|---|
| **迁移激进度** | **注册表优先 + Rating 新类型证明扩展点**。建 server+client Field Type 注册表；10 个内建类型的 per-type 逻辑搬进**核心捆绑模块**（`apps/web` 内，**不**物理搬进包）并经 bootstrap 注册；用一个真新类型 `plugin-rating` 端到端证明扩展点。 |
| **client 渲染机制** | **客户端渲染器注册表**（镜像 server）。`cell-renderers.tsx`（322 行 switch）改为按 `field.type` 查表；内建渲染器经 client bootstrap 注册，Rating 自注册。 |
| **ADR-0005 强制点** | 留核心：写路径（`cell.ts`/`record.ts`）的 empty→删行 / error→拒 / value→存 JSONB **统一策略**不动；插件只提供 per-type `normalizeCellValue(options, raw)→NormalizedCell`。 |

---

## 2. 拆分边界（field-types.ts → 核心 + 注册表）

现有 `field-types.ts`（187 行）按 ADR-0005 边界拆：

**留核心（策略/类型/共享）**
- `NormalizedCell = { empty: true } | { value: CellValue } | { error: string }`、`CellValue`、`FieldOptions` 类型。
- `selectOptionSchema`（select/multi-select 共享）。
- 写路径编排：`cell.ts`/`record.ts` 消费 `NormalizedCell` 施加 ADR-0005 策略——不变。
- `FieldType` const（10 内建字面量）留作**内建目录**；`parseOptions`/`defaultOptions`/`normalizeCellValue` 变为**薄分发**到注册表。

**进注册表（per-type 行为，`FieldTypeContribution`）**
- `optionsSchema`（zod）、`defaultOptions()`、`normalizeCellValue(options, raw)`、`meta{label,description}`。
- 10 个内建类型的这些逻辑（现散在 `optionsSchemas`/`defaultOptions`/`normalizeCellValue`/`FIELD_TYPE_META`）逐字搬进核心捆绑模块 `server/plugins/builtin-fields/`。

> `FieldType` const 保留供内建代码引用；新类型（`'rating'`）只进注册表、**不**进 const。所有消费方改为「查注册表」而非「switch on FieldType」，故对任何已注册类型工作。`Expression` 的特殊性（computed、`normalizeCellValue` 返 error、值由 `expression-eval.ts` 写时求值）原样保留在其 contribution 里。

---

## 3. 服务端 Field Type 注册表

- **SDK** 加 `FieldTypeContribution { type: string; optionsSchema: ZodType; defaultOptions: () => FieldOptions; normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell; meta: { label: string; description: string } }`，及共享 `NormalizedCell`/`CellValue`/`FieldOptions` 类型（从 SDK 导出，核心与插件共用）。
- 复用 Plan 1 建的 `fieldTypeRegistry` 骨架（`Registry<unknown>` → 收紧为 `Registry<FieldTypeContribution>`）。
- **内建注册**：`server/plugins/builtin-fields/index.ts` 导出 10 个 `FieldTypeContribution`；`server/plugins` bootstrap 直接注册（内建是「核心自带」，不经 plugins.config 的插件清单）。
- **消费方改造**（server）：`field-types.ts` 的 `parseOptions(type,raw)` → `fieldTypeRegistry.get(type).optionsSchema.parse(raw ?? {})`；`normalizeCellValue(type,options,raw)` → `registry.get(type).normalizeCellValue(options, raw)`；`defaultOptions(type)` → `registry.get(type).defaultOptions()`。`cell.ts`/`record.ts`/`field.ts` routers 经这些薄分发间接走注册表，签名不变（零改动或极小改动）。

---

## 4. 客户端 Field Renderer 注册表

- **SDK** 加 `FieldRendererContribution { type: string; CellRenderer: ComponentType<CellRenderProps>; CellEditor: ComponentType<CellEditProps>; OptionsEditor?: ComponentType<OptionsEditProps> }`（props 类型 SDK 定义，核心与插件共用）。
- 客户端 `fieldRendererRegistry`（新，住客户端 bundle）。
- **内建注册**：`lib/plugins/builtin-field-renderers/` 把 `cell-renderers.tsx` 的 10 个 case 拆成 10 个渲染器 + 编辑器，经 client bootstrap（`plugins.client.ts` 旁的核心 bootstrap）注册。
- **消费方改造**（client）：`cell-renderers.tsx` → 按 `field.type` 查 `fieldRendererRegistry`；`field-type-picker` → 列 `fieldTypeRegistry` 的 meta（新类型自动出现在「加字段」）；`field-editor-dialog` → 用注册表 `OptionsEditor`。
- **filter-panel**：完整 filter 扩展性另立；本期对未知类型**回退**（不崩，按文本/相等处理），保证 Rating 不破坏 filter UI。

---

## 5. Rating 插件（证明扩展点，`packages/plugin-rating`）

- `./server`：`'rating'` 的 `FieldTypeContribution`——`optionsSchema { max?: number }`（默认 5）、`defaultOptions { max: 5 }`、`normalizeCellValue`（空→empty；数字 1..max→value；越界/非数→error）、`meta { label: 'Rating', description: 'Star rating' }`。值形态 = number（存 JSONB，符 ADR-0005）。
- `./client`：星星 `CellRenderer`（只读星）、`CellEditor`（点选星）、`OptionsEditor`（设 max）。
- 经 `plugins.config`（server）+ `plugins.client`（client）注册。加完包，UI 即可建 Rating 字段、Grid 编辑、CSV 导出——**核心零改动**。

---

## 6. 拆成两个实现计划

Field Type 面太大，拆两个各自可测的计划：

- **Plan 3a（server）**：SDK 类型（FieldTypeContribution + 共享值类型）+ 服务端注册表收紧 + `builtin-fields` server 模块（10 类型）+ `field-types.ts` 薄分发 + routers 走注册表。**无 UI 变化**，靠逐类型 `normalizeCellValue`/`parseOptions`/`defaultOptions` parity 测试兜底 ADR-0005。可独立合并。
- **Plan 3b（client + Rating）**：SDK 渲染器类型 + 客户端渲染器注册表 + `builtin-field-renderers` 模块（拆 cell-renderers）+ field-config/picker 改造 + client bootstrap + Rating 插件端到端。含浏览器回归。

---

## 7. 测试策略

- **Server parity（Plan 3a 核心）**：对 10 个内建类型，逐类型断言注册表分发后的 `normalizeCellValue`/`parseOptions`/`defaultOptions` 与迁移前**逐 case 等价**（含 empty/error/value 三态、越界、未知 option、expression 拒写）。这是 ADR-0005 不破的护栏。
- **注册表单测**：register/get/未知类型报错/list（复用 `createRegistry` 形状）。
- **Client（Plan 3b）**：渲染器注册表单测；cell-renderers 改造后 Grid 渲染/编辑各内建类型回归；Rating 端到端浏览器回归（建 Rating 字段→打分→导出）。
- **类型**：`tsc` 通过；`FieldType` 消费方改注册表后无 `any` 泄漏。

---

## 8. 风险

| 风险 | 应对 |
|---|---|
| 写路径 `normalizeCellValue` 改分发，回归面大（ADR-0005） | 逐类型 parity 测试先行；薄分发保持 `field-types.ts` 公共签名不变，routers 几乎不动 |
| `cell-renderers.tsx`（322 行）拆分引入渲染回归 | 逐类型拆 + Grid 渲染/编辑回归；Plan 3b 单列 |
| `FieldType` const 被 switch 消费处遗漏（新类型走不到） | 审计 10 个 import 点，全改为注册表查表 + 未知类型回退（filter-panel） |
| expression 特殊语义（写时求值）被破坏 | expression contribution 原样保留 `normalizeCellValue` 返 error；`expression-eval.ts` 写路径不动 |

---

## 9. 与 ADR 兼容

沿用 ADR-0001~0005 不变（值语义强制点留核心）。新增 ADR-0009（Field Type 注册表 + 内建留核心 + 值语义核心/插件切分）。延续 ADR-0007（注册表）/0008（server/client 拆分、CoreServerApi）。
