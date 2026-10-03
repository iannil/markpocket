# Phase 5A — Grid Editor 视觉重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 grid 视图改为 Paper & Ink 外观（2 行表头、行号列、加行/加列 ghost、hairline、10 种 Paper & Ink cell），保留全部数据/实时/mutation 逻辑与现有点击编辑。

**Architecture:** 就地重构 `grid-editor.tsx`（保留数据/逻辑层，重写表格外壳 JSX），把 `renderCell` 抽成新 `cell-renderers.tsx` 的 `CellRenderer` 组件；view-config 组件与 link-cell 就地 restyle；grid 表格样式落 `globals.css`。

**Tech Stack:** Next 16 App Router、tRPC（`@/lib/trpc/client`）、Tailwind + Paper & Ink token。

**Spec:** `docs/superpowers/specs/2026-07-03-phase5a-grid-editor-visual-design.md`

## Global Constraints

- **无测试框架**：无测试代码。TDD 循环适配为 **实现 → typecheck → lint → 浏览器肉眼 → commit**。
- **验证命令**：`pnpm --filter @markpocket/web typecheck && pnpm lint`（均须通过）。浏览器 `http://localhost:7420`（`./dev.sh`）。
- **不改后端**：无 schema 迁移、无新 tRPC endpoint。只沿用现有 hooks 与 `/api/upload`、`/api/files/:id`。
- **保留数据/实时/mutation 逻辑**：`GridEditor` 顶部 47–170 行（queries/mutations/state/patchOptions/startEdit/commitEdit/startResize/字段对话框）**不动语义**。
- **编辑保持现有点击模型**：不加选中态、键盘导航（归 5B）。`CellHistory` 每 cell 渲染**保持不动**（5B 替换为 dock）。
- **Paper & Ink**：hairline `border-border`；无 shadow；白底；主色墨黑 `bg-primary text-primary-foreground`；number 右对齐 `font-mono tabular-nums`，负数 `text-destructive`；boolean 用 `✓`（ink）非 checkbox；single-select 左 6px 圆点（`choice.color`）；expression 左 2px ink 竖条；空值淡 `—`（`text-muted-foreground`）；cell 顶部对齐、padding 4px×10px。
- **FieldType（10 种）**：`text/number/boolean/date/single-select/expression/multi-select/user/link/attachment`（`@/lib/field-types` 的 `FieldType`）。`long-text` 不存在，`text/default` 统一走 text。
- **不做**：选中态/键盘导航/history dock（5B）、表达式列头 chip 序列、非 grid 视图、`[⋯]` overflow 合并。

---

### Task 1: 抽取 `cell-renderers.tsx`（行为不变）

把 `grid-editor.tsx` 的 `renderCell` 10-case switch 原样搬进新组件 `<CellRenderer>`，编辑态与 mutation 经 props 传入。**本 task 不改任何视觉**——grid 看起来、用起来与现在完全一致；只是把渲染逻辑挪出去。

**Files:**
- Create: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`（删除 `renderCell`，调用 `<CellRenderer>`）

**Interfaces:**
- Produces:
  ```ts
  export interface CellRendererProps {
    field: { id: string; name: string; type: FieldType; options: Record<string, unknown> };
    record: { id: string; cells: Record<string, unknown> };
    users: Array<{ id: string; name: string | null; email: string | null }>;
    isEditing: boolean;
    draft: string;
    onDraftChange: (v: string) => void;
    onStartEdit: (current: unknown) => void;
    onCommitEdit: () => void;   // 提交 draft（text/number/date）
    onUpsert: (value: unknown) => void;
  }
  export function CellRenderer(props: CellRendererProps): JSX.Element;
  ```
- Consumes: 现有 `LinkCell`（`./link-cell`）、`formatNumberToString`（`@/lib/format-number`）、`FieldType`/`SelectOption`（`@/lib/field-types`）、ui `Input/Select*/Popover*`。

- [ ] **Step 1: 新建 `cell-renderers.tsx`，搬入 renderCell**

从 `grid-editor.tsx` 现有 `renderCell(rec, field)`（约 172–408 行）整段搬入 `CellRenderer`，按以下**逐项替换**（语义等价，勿改渲染结构）：

| grid-editor 里的写法 | CellRenderer 里替换为 |
|---|---|
| `const value = rec.cells[field.id]` | `const value = record.cells[field.id]` |
| `editing?.recordId === rec.id && editing?.fieldId === field.id` | `isEditing`（prop） |
| `draft` | `draft`（prop） |
| `setDraft(x)` | `onDraftChange(x)` |
| `startEdit(rec.id, field.id, value)` | `onStartEdit(value)` |
| `commitEdit(FieldType.X, rec.id, field.id)` | `onCommitEdit()` |
| `upsertCell.mutate({ recordId: rec.id, fieldId: field.id, value: V })` | `onUpsert(V)` |
| `usersData ?? []` | `users`（prop） |
| `rec.id` / `field.id`（`LinkCell`/attachment 等） | `record.id` / `field.id` |

组件骨架：
```tsx
'use client';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatNumberToString } from '@/lib/format-number';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { LinkCell } from './link-cell';

export interface CellRendererProps { /* 如上 */ }

export function CellRenderer({
  field, record, users, isEditing, draft, onDraftChange, onStartEdit, onCommitEdit, onUpsert,
}: CellRendererProps) {
  const value = record.cells[field.id];
  switch (field.type) {
    /* …搬入的 10 个 case，按上表替换… */
  }
}
```
> attachment 的 `fetch('/api/upload')` 逻辑原样保留（把 `upsertCell.mutate({recordId: rec.id, fieldId: field.id, value: [...]})` 换成 `onUpsert([...])`）。

- [ ] **Step 2: grid-editor.tsx 删除 renderCell、改调用**

删除 `grid-editor.tsx` 里整个 `function renderCell(...) {...}`（172–409 行），并 `import { CellRenderer } from './cell-renderers'`。把 tbody 里 `{renderCell(rec, f)}`（约 548 行）替换为：
```tsx
<CellRenderer
  field={f}
  record={rec}
  users={usersData ?? []}
  isEditing={editing?.recordId === rec.id && editing?.fieldId === f.id}
  draft={draft}
  onDraftChange={setDraft}
  onStartEdit={(v) => startEdit(rec.id, f.id, v)}
  onCommitEdit={() => commitEdit(f.type, rec.id, f.id)}
  onUpsert={(v) => upsertCell.mutate({ recordId: rec.id, fieldId: f.id, value: v })}
/>
```
删除 grid-editor.tsx 中因搬走而不再用的 import（如 `Popover*`、`SelectOption`、`LinkCell`、`formatNumberToString` —— 仅删“确实不再被 grid-editor 自身使用”的；`Select*`/`Input` 若外壳仍用则保留）。以 typecheck 的 unused 报错为准。

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过，无 unused import 报错。

- [ ] **Step 4: 浏览器验证（无视觉变化 = 成功）**

`/bases/<baseId>/tables/<tableId>`（用有数据的 Project Tracker 表）：网格外观**与改动前一致**；每种 cell 仍可编辑/写入（text 点击编辑、single-select 下拉、multi-select 勾选、boolean 勾、number/date 编辑、user 选择、link/attachment）。无控制台报错。

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx" "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx"
git commit -m "refactor(grid): 抽取 CellRenderer（行为不变）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: cell 渲染 → Paper & Ink

在 `cell-renderers.tsx` 内把 10 种 cell 的**只读态**改为 §5 的 Paper & Ink 样式（编辑态输入框沿用现有，仅统一高度/边框）。逐 case 目标：

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx`

- [ ] **Step 1: 各 case 只读渲染改样式**

统一：cell 内容容器 `flex min-h-[28px] items-start px-2.5 py-1 text-sm`（顶对齐、padding 4×10 近似）。空值渲染 `<span className="text-muted-foreground">—</span>`。

- **text / default**：只读 `<button className="flex w-full items-start px-2.5 py-1 text-left text-sm" onClick={() => onStartEdit(value)}>{value == null || value === '' ? <span className="text-muted-foreground">—</span> : String(value)}</button>`。编辑态 `Input` 加 `className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"`。
- **number**：只读右对齐 mono：`<button className="flex w-full items-start justify-end px-2.5 py-1 text-right font-mono tabular-nums text-sm ..." onClick=...>` 内容 `formatNumberToString(...)`；若 `Number(value) < 0` 加 `text-destructive`。空 → `—`。编辑态 number `Input` 同上样式。
- **boolean**：只读 `<button className="flex w-full items-start px-2.5 py-1" onClick={() => onUpsert(!value)}>{value ? <span className="text-foreground">✓</span> : null}</button>`（不用 checkbox）。
- **date**：只读 mono `<button ... className="... font-mono text-sm">`；值为 `YYYY-MM-DD` 字符串；若等于今天/昨天，显示 muted `today`/`yesterday`（用一个本地 `relativeDate(s: string)` helper：比较 `new Date(s).toDateString()` 与今天/昨天）。空 → `—`。编辑态沿用现有 date Input。
- **single-select**：只读左 6px 圆点 + 名称：`<span className="mr-1.5 inline-block size-1.5 rounded-full" style={{ backgroundColor: selected?.color }} />{selected?.name}`；空 → `—`。编辑态 `Select` 保留（`SelectTrigger` 加 `className="h-7 rounded-none border-0 focus:ring-0"`）。
- **multi-select**：只读最多 2 个 chip + `+N`：chip `<span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">{name}</span>`；超 2 个显示 `<span className="text-xs text-muted-foreground">+{n-2}</span>`。编辑态 Popover 保留。
- **user**：只读 20×20 首字母 avatar + 名字：`<span className="mr-1.5 flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px]">{initials}</span>{name ?? email}`（`initials` 用 name/email 首字母，同 members 页做法）。空 → `—`。编辑态 Select 保留。
- **link**：`<LinkCell>` 保留逻辑；样式改动放 Task 4（link-cell.tsx restyle）。本 case 不改。
- **attachment**：只读缩略图 24×24 圆角：图片 `<img src={/api/files/${id}} className="size-6 rounded object-cover" />`（多于 1 个用 `-ml-1` 堆叠），非图片沿用 `📎` 链接；保留 `+upload` 逻辑，样式 `text-xs text-muted-foreground hover:text-foreground`。
- **expression**：只读容器加左 2px ink 竖条：外层 `<div className="flex items-start border-l-2 border-foreground px-2.5 py-1 text-sm">`；数值走 number 样式（mono/right 可选）；`__error` → `text-destructive`；`null` → 空。

新增本文件顶部小 helper（纯函数）：
```tsx
function initials(s: string): string {
  return s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
function relativeDate(s: string): string | null {
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'today';
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return null;
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 3: 浏览器验证**

Project Tracker 表：number 右对齐等宽、负数红；boolean 显 `✓`/空；single-select 左色点；date 显 today/日期；multi-select chip + `+N`；user 首字母 avatar；expression 左 ink 竖条；空值 `—`。编辑仍可用。

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx"
git commit -m "style(grid): 10 种 cell Paper & Ink 渲染

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: grid 外壳 + globals.css → Paper & Ink

重写 `grid-editor.tsx` 的 `<table>` 外壳：2 行表头、行号列、加行/加列 ghost、hairline、组头 restyle。`CellHistory` 每 cell 保留不动。

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`（return 内 `<table>` 部分，约 479–585 行）
- Modify: `apps/web/src/app/globals.css`（`.markpocket-grid` 规则）

- [ ] **Step 1: globals.css 网格样式**

在 `globals.css` 追加/替换 `.markpocket-grid` 规则：
```css
.markpocket-grid { width: 100%; background: var(--background); }
.markpocket-grid th, .markpocket-grid td { border-color: var(--border); }
.markpocket-grid td { vertical-align: top; }
.markpocket-grid thead th { height: 36px; }
```
（若已有 `.markpocket-grid` 规则则合并，勿重复定义冲突项。）

- [ ] **Step 2: 表头改 2 行**

把 thead（约 488–520 行）单行表头改为每列 2 行结构。行号列头空白 + 右 hairline。每字段列头：
```tsx
<th key={f.id} className="relative border-b border-l border-border p-0" onDoubleClick={() => openEditField(f)}>
  <button className="block w-full px-2.5 pt-1 text-left" onClick={() => openEditField(f)} title={`${f.name} (${f.type})`}>
    <div className="text-xs font-medium text-foreground">
      {f.name}
      {viewOptions.sort?.find((s) => s.fieldId === f.id) && (
        <span className="ml-1 text-muted-foreground">
          {viewOptions.sort.find((s) => s.fieldId === f.id)?.dir === 'desc' ? 'Z↓' : 'A↓'}
        </span>
      )}
    </div>
    <div className="pb-1 font-mono text-[10px] text-muted-foreground">{f.type}</div>
  </button>
  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20" onMouseDown={(e) => startResize(e, f.id)} />
</th>
```
> `viewOptions.sort` 项结构参考 `@/lib/view-ast`（`{fieldId, dir}`）；若字段名不同以该类型为准。加列 ghost th（见 Step 4）。

- [ ] **Step 3: 行号列 + 组头**

行号 td：把当前"删除按钮"td（约 537 行）改为显示行号 + hover 出删除。用组内序号：给 `g.records.map((rec, i) => ...)` 传 index，行号 td：
```tsx
<td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
  <span className="group-hover:hidden">{i + 1}</span>
  <button className="hidden text-muted-foreground hover:text-destructive group-hover:inline" onClick={() => deleteRecord.mutate({ id: rec.id, tableId })} title="Delete record">×</button>
</td>
```
组头（约 524–533 行）restyle：`className="border-b border-border bg-muted/30"`，标签 `text-xs font-medium` + 计数 `text-muted-foreground`。

- [ ] **Step 4: 加行 ghost + 加列 ghost**

把 tfoot 的 `+ New record` Button（570–583 行）换成整行 ghost：
```tsx
<tfoot>
  <tr>
    <td colSpan={displayedFields.length + 2} className="p-0">
      <button
        className="flex w-full items-center justify-center gap-1 border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
        onClick={() => createRecord.mutate({ tableId })}
        disabled={createRecord.isPending}
      >+ new record</button>
    </td>
  </tr>
</tfoot>
```
加列 ghost：thead 末尾 `+ field` th（约 511–518 行）restyle 为右侧灰条 + `+`：
```tsx
<th className="border-b border-l border-border bg-muted/20 p-0">
  <button className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground" onClick={openCreateField} title="Add field">+</button>
</th>
```
tbody 行末的空 td（约 554 行）保持 `<td className="border-b border-border border-l" />`。

- [ ] **Step 5: 外框 hairline**

外层 `<div className="overflow-auto rounded border">`（479 行）→ `className="overflow-auto rounded-md border border-border"`。cell td（547 行）保持 `border-b border-l border-border p-0`（加 `border-border`），`CellHistory` 块**保留原样**。

- [ ] **Step 6: typecheck + lint + 浏览器验证**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
浏览器：2 行表头（名+类型）、行号列（hover 出 ×）、加行虚线 ghost（hover 转实线）、加列 `+` 灰条、hairline 网格、组头 restyle；排序时列头显示 `A↓`。建行/删行/建改字段/resize 照常。

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx" apps/web/src/app/globals.css
git commit -m "style(grid): Paper & Ink 表格外壳（2 行表头/行号/ghost/hairline）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 工具栏 + view-config + link-cell restyle

把工具栏与 view-config 组件、link-cell 就地 restyle 为 Paper & Ink。保留全部 props/逻辑。

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`（return 内工具栏区，约 411–477 行）
- Modify: `apps/web/src/components/view-config/view-tabs.tsx`
- Modify: `apps/web/src/components/view-config/filter-panel.tsx`
- Modify: `apps/web/src/components/view-config/sort-menu.tsx`
- Modify: `apps/web/src/components/view-config/view-fields-menu.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/link-cell.tsx`

- [ ] **Step 1: 工具栏区 restyle（grid-editor.tsx）**

外层容器（412 行）`className="flex h-full flex-col gap-2 overflow-auto p-4"`。标题行去掉 `text-xl font-bold` → `text-sm font-semibold`。filter/sort/fields/group 控件统一为 Paper & Ink 小按钮：filter `Button` 用 `variant={showFilter ? 'default' : 'outline'} size="sm"` 保留，其余 `Select`/menu 触发器统一 `h-7 rounded-md border-border text-sm`。保持所有 onClick/onChange 不变。

- [ ] **Step 2: view-tabs.tsx restyle**

读该文件，把 tab 项改为 Paper & Ink：active tab `border-b-2 border-foreground text-foreground`，非 active `border-transparent text-muted-foreground hover:text-foreground`，容器 `border-b border-border`。保留 `onSelect`/`views`/`activeViewId` 逻辑与"+新视图"入口。

- [ ] **Step 3: filter-panel / sort-menu / view-fields-menu restyle**

逐个读文件，把边框/背景换成 `border-border`、`bg-background`/`bg-muted`，按钮换 Paper & Ink（无 shadow、hairline、active 墨黑）。**只改 className，不动逻辑与 props**。

- [ ] **Step 4: link-cell.tsx restyle**

读该文件，把链接标题 + 选择器/popover 换 Paper & Ink（hairline、`text-sm`、hover `bg-muted`）。§6.4 的 hover 预览 popover / ⌘点击跳转若现有已具备则 restyle；若不具备则**不新增**（属交互，非本 spec 强制）。保留 `recordIds`/`targetTableId`/`onChange`。

- [ ] **Step 5: typecheck + lint + 浏览器验证**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
浏览器：view tabs 墨黑下划线 active；filter/sort/fields/group 为 Paper & Ink；filter 面板、排序菜单、字段菜单外观统一；link cell restyle。所有筛选/排序/隐藏/分组/link 编辑功能不回归。

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx" "apps/web/src/app/bases/[baseId]/tables/[tableId]/link-cell.tsx" apps/web/src/components/view-config/
git commit -m "style(grid): 工具栏 + view-config + link-cell Paper & Ink

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 收尾（全部 task 后）

- [ ] 浏览器整体回归：10 种 cell 渲染 + 编辑、表头/行号/ghost、工具栏/筛选/排序/分组/隐藏、resize、建改字段、link/attachment。
- [ ] 更新 `docs/redesign/status.md` + `docs/STATUS.md`：Phase 5 标注 5A（视觉）完成、5B（交互）待做。commit。

## 明确不做（见 spec §1）

选中态/键盘导航/history dock（5B）、表达式列头 chip、long-text、非 grid 视图、`[⋯]` overflow。
