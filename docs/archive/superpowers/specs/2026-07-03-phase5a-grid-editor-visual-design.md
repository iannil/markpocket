# Phase 5A — Grid Editor 视觉重设计（Paper & Ink）

> **日期**：2026-07-03
> **范围**：Paper & Ink 重设计 Phase 5 的前半（视觉）。Phase 5 拆两个 spec：**5A 视觉**（本文，5.1 grid 外壳 + 工具栏 + 5.2 十种 cell 渲染）与 **5B 交互**（另立：选中态 + 键盘导航 + inline 编辑 + cell 历史 dock）。
> **参考**：`docs/redesign/2026-07-01-paper-ink-design.md` §6.4；`docs/redesign/2026-07-01-paper-ink-plan.md` Phase 5。
> **原则**：保留全部数据/实时/mutation 逻辑，只换外壳 + 抽 cell 渲染。就地重构，不新建组件树、不改后端。

---

## 1. 目标与非目标

**目标**：把 grid 视图（`/bases/[baseId]/tables/[tableId]`）从旧 Carbon & Citrus 外观改为 Paper & Ink——2 行表头、行号列、加行/加列 ghost、hairline、10 种 cell 的 Paper & Ink 渲染、工具栏 restyle。

**非目标（本 spec 不做）**：
- 选中 cell 态、键盘导航（方向键/Enter/Tab/Esc）→ **5B**
- cell 历史 dock（右侧滑入）→ **5B**（现有 `CellHistory` 保持不动，本 spec 不碰其触发方式）
- `long-text` 类型渲染（`FieldType` enum 无此类型，无后端）
- Form / Kanban / Gallery 等非 grid 视图的重设计（各自独立）
- 工具栏 `[⋯]` overflow 合并（§6.4 图示的收纳菜单）——刻意偏离，控件就地 restyle、保持可见（YAGNI）
- **表达式列头的 chip 序列**（§6.4 图示 `[amount] × [qty]`）——需解析表达式并把 fieldId 映射为字段名 chip，属新逻辑而非换肤；本 spec 列头第二行仅显示类型标签 `expression`，chip 序列留后续。（expression **cell** 的左 2px ink 竖条仍做）
- 任何 tRPC endpoint / schema 改动

---

## 2. 现状（已核实）

`apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`（596 行）包含：
- **数据/逻辑层**（保留）：`field.list` / `view.list` / `auth.listUsers` / `record.list` 查询；`cell.upsert` / `record.create` / `record.delete` / `view.updateOptions` mutation；`activeViewId` / `editing` / `draft` / `widths` 等状态；`patchOptions` / `startEdit` / `commitEdit` / `startResize` / 字段对话框 handlers。
- **`renderCell(rec, field)`**（抽出并 restyle）：10 case switch（text/number/boolean/date/single-select/multi-select/user/link/attachment/expression）。
- **grid 外壳 JSX**（重写）：`<ViewTabs>` + 标题 + `+ Field` + filter/sort/fields/group 工具栏 + `<FilterPanel>` + `<table className="markpocket-grid">`（colgroup 行号40/字段/加列120；单行 thead；分组 tbody）。

`FieldType` enum（`src/lib/field-types.ts`）实际 **10 种**：`text, number, boolean, date, single-select, expression, multi-select, user, link, attachment`。

现有组件（就地 restyle，保留 props/逻辑）：`components/view-config/{view-tabs,filter-panel,sort-menu,view-fields-menu}.tsx`、`tables/[tableId]/link-cell.tsx`。

---

## 3. 文件改动

| 文件 | 动作 | 责任 |
|---|---|---|
| `tables/[tableId]/cell-renderers.tsx` | **新增** | 导出 `CellRenderer`（10 类型的 Paper & Ink 只读/编辑渲染），mutation 与编辑态经 props 传入 |
| `tables/[tableId]/grid-editor.tsx` | 改 | 保留数据逻辑；重写表格外壳 JSX（2 行表头/行号/ghost/hairline）；`renderCell` → 调 `<CellRenderer>` |
| `components/view-config/view-tabs.tsx` | restyle | Paper & Ink tab（active 墨黑下划线，hairline，无 shadow） |
| `components/view-config/filter-panel.tsx` | restyle | Paper & Ink |
| `components/view-config/sort-menu.tsx` | restyle | Paper & Ink |
| `components/view-config/view-fields-menu.tsx` | restyle | Paper & Ink |
| `tables/[tableId]/link-cell.tsx` | restyle | link cell 标题 + hover popover（§6.4） |
| `app/globals.css` | 改 | `.markpocket-grid` → hairline、行号列、36px 表头、顶对齐、cell padding 4×10 |

---

## 4. `CellRenderer` 接口

```ts
// cell-renderers.tsx
export function CellRenderer(props: {
  field: FieldLike;               // {id, name, type, options}
  record: RecordLike;             // {id, cells}
  users: Array<{ id: string; name: string | null; email: string | null }>;
  isEditing: boolean;             // editing?.recordId === record.id && editing?.fieldId === field.id
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: (current: unknown) => void;
  onCommitEdit: () => void;       // commits `draft` for text/number/date
  onUpsert: (value: unknown) => void; // upsertCell.mutate({recordId, fieldId, value})
}): JSX.Element;
```

`GridEditor` 保有 `editing/draft` 状态与所有 mutation；`CellRenderer` 无自身数据获取（`users` 由父传入；link cell 仍用 `LinkCell` 自身的 targetTable 查询）。

---

## 5. 10 种 cell 渲染（§6.4，Paper & Ink）

| 类型 | 只读渲染 | 编辑 |
|---|---|---|
| text | 左对齐 sans，空 → 淡 `—` | 点击 → inline `Input`，Enter/blur commit |
| number | 右对齐 mono `tabular-nums`；负数 ink 红（`text-destructive`） | 点击 → inline number `Input` |
| boolean | `✓`（ink）或空白，**不用 checkbox 形** | 点击整格 toggle（`onUpsert(!value)`） |
| date | mono `YYYY-MM-DD`；等于今天/昨天 → muted `today`/`yesterday` | 点击 → inline date `Input` |
| single-select | 左 6px 圆点（`choice.color`）+ 名称，空 → `—` | `Select`（restyle） |
| multi-select | 最多 2 个 chip + `+N` 灰字 | `Popover` 勾选（restyle） |
| user | 20×20 首字母 avatar + 名字 | `Select`（restyle） |
| link | 关联 record 标题；hover popover 预览；`⌘/Ctrl+点击`跳转目标 record | `LinkCell` 选择器（restyle） |
| attachment | 24×24 圆角 4px 缩略图，多于 1 个堆叠 | `+upload`（保留现有 `/api/upload` 逻辑） |
| expression | 物化值按结果类型渲染（number 走 number 样式）；左 2px ink 竖条标识计算字段；`__error` → `text-destructive` | 只读 |

空值统一淡 `—`（`text-muted-foreground`）。cell 顶部对齐，padding 4px×10px。

---

## 6. Grid 外壳（§6.4）

- **行号列**：`muted-foreground`，右 1px hairline；宽 ~40px。
- **列头**：36px 高，2 行——第 1 行字段名（font-medium/500），第 2 行字段类型；排序/筛选生效时在列头显示状态标识（如 `A↓`）。表达式列头第 2 行同样显示类型标签 `expression`（chip 序列见 §1 非目标）。保留列宽 resize 手柄。
- **加行 ghost**：末行整行虚线 hairline + 居中 `+`，hover 转实线；点击 → `record.create`。
- **加列 ghost**：右侧 ~32px 灰条 + `+`，点击 → 打开建字段对话框（现有 `openCreateField`）。
- **分组**：保留现有分组渲染（`groups`），组头 restyle 为 Paper & Ink（hairline + 组标签 + 计数）。
- 整体 hairline（`border-border`）、无 shadow、白底。

---

## 7. 工具栏

- `<ViewTabs>` restyle：Paper & Ink tab 条（active 墨黑下划线）。视图切换逻辑不变。
- filter / sort / fields / group 控件就地 restyle 为 Paper & Ink chip/button；filter 生效计数保留。
- `<FilterPanel>` 展开面板 restyle。
- 不做 `[⋯]` overflow 收纳（见 §1 非目标）。

---

## 8. 数据流与错误处理

- 全部沿用现有 `trpc.*` hooks 与 `utils.*.invalidate`；实时 invalidate 由既有 realtime-provider 处理，不改。
- 编辑仍是现有点击模型：`startEdit` 设 `editing`+`draft`，`commitEdit` 提交 `draft`（text/number/date）；其余类型即时 `onUpsert`。
- expression `__error` 已有哨兵渲染（`text-destructive`），沿用。
- 无新增校验（后端 `normalizeCellValue` 负责）。

---

## 9. 验收

- grid 视图整体为 Paper & Ink：白底、hairline、行号列、2 行表头、加行/加列 ghost、顶对齐。
- 10 种 cell 按 §6.4 渲染；空值 `—`；number 右对齐 mono、负数红；boolean `✓`；single-select 色点；expression 左 ink 竖条。
- 现有交互不回归：点击编辑 text/number/date；select/multi/user/link/attachment/boolean 正常写入；filter/sort/group/hide/resize/加行/加列/建改字段 全部照常。
- typecheck + lint 通过；浏览器肉眼验证（无自动化测试框架）。
- 无 tRPC/schema 改动。

---

## 10. 交接给 5B（交互）

- 选中 cell 态（`selectedCell`）+ 2px ink 描边、方向键/Enter/Tab/Esc 导航、编辑态 `bg-muted`。
- cell 历史 dock（右侧 280px 滑入，选中 cell 时；时间线 + restore；Esc 关闭）——替换现有 `CellHistory` 触发。
- 5A 的 `CellRenderer` 接口预留 `isEditing`，5B 在其上加 `isSelected` 等。
