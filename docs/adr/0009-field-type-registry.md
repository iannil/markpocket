# ADR-0009：Field Type 注册表（服务端值语义）

- **状态**：Accepted
- **日期**：2026-07-10
- **相关**：落地 `docs/archive/superpowers/specs/2026-07-10-field-type-extension-point-design.md`（Plan 3a）；受 ADR-0005 约束；延续 ADR-0007（加载器/注册表 barrel 纪律）、ADR-0008（server/client 拆分）

## 背景

`field-types.ts` 用静态 switch 写死 10 个字段类型的 `optionsSchema` / `defaultOptions` / `normalizeCellValue`。第三方要加字段类型必须改核心源码。且该文件被 client 与 server 同时 import，值语义与 UI 数据混在一起。

## 决策

1. **值语义进注册表**：每类型的 `optionsSchema / defaultOptions / normalizeCellValue / meta` 收进 `FieldTypeContribution`（SDK 定义），存 `fieldTypeRegistry`（收紧为 `Registry<FieldTypeContribution>`）。
2. **ADR-0005 策略留核心**：`cell.ts` 写路径消费 `NormalizedCell` 施加 empty→删行 / error→拒 / value→存 JSONB 的统一策略——**不变**；插件只提供 per-type「原始值→NormalizedCell」规约。逐类型 parity 测试（empty/value/error 三态 + 越界 + 未知 option + expression 拒写）兜底不破。
3. **内建留核心、不搬包**：10 内建类型的 contribution 住 `server/plugins/builtin-fields/`，barrel（`server/plugins/index.ts`）bootstrap 直接注册（核心自带，不经 `plugins.config` 插件清单）。
4. **client/server 分离**：`field-types.ts` 只留客户端可见数据（`FieldType` const、`FIELD_TYPE_META`、`selectOptionSchema`、`SelectOption`/`CellValue`/`NormalizedCell`/`FieldOptions` 类型）；值语义分发移到服务端 `server/plugins/field-value.ts`，避免把 server 注册表拖进 client bundle。
5. **barrel 读取纪律**：`field-value.ts` 从 barrel `@/server/plugins`（而非 `./registry` 直连）读 `fieldTypeRegistry`，确保导入即触发 barrel 的内建注册副作用——否则冷进程首个 cell/field 写会抛 `Unknown field type`。此为 ADR-0007「消费者经 barrel 读注册表」纪律的一次落实（review 抓到直连回退并修正）。

## 后果

**正面**：第三方可加字段类型（文档示例 Rating 证明）；ADR-0005 值语义有逐类型 parity 护栏；client bundle 不含 server 注册表。
**负面**：值语义分发依赖 barrel bootstrap 已注册内建（靠 barrel import 纪律保证，已有测试守）；`FieldType` const 与注册表并存（const 为内建目录，运行时以注册表为准）——`field.create` 校验仍用 `z.enum(FIELD_TYPES)` const，registry-driven 校验待后续计划。（更新：`PluginDefinition.fieldTypes` 已收紧为 `Contribution<FieldTypeContribution>[]`，loader 处的 `as` 桥接已删除。）

## 备选方案

- **全 10 类型物理搬进 `plugin-builtin-fields` 包**：churn 大、动已完成 v1 写路径过深。否决——内建留核心。
- **dispatch 留 `field-types.ts`**：会把 server 注册表 import 进 client bundle（client 消费方仅用 `FieldType`/meta，却被拖进注册表）。否决——移到服务端 `field-value.ts`。

## 反悔代价

低。分发是加法层，回退＝把 `field-value` 三函数改回 `field-types.ts` 的静态 switch。值语义 parity 测试与 barrel 注册测试是回归护栏。
