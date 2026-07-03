# Phase 5B — Grid Editor 交互 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 grid 有表格感——点击/方向键选中 cell（2px ink 描边）、标准键盘导航与编辑、右侧 cell 历史 dock（替换 per-cell 历史入口）。

**Architecture:** 交互态由 `grid-editor.tsx` 持有（新增 `selectedCell`）；键盘落在一个可聚焦的 grid wrapper 上；新 `cell-history-dock.tsx` 用现有 `history.list` + `cell.upsert`。不改后端、不改 `CellRenderer` 数据接口。

**Tech Stack:** Next 16 App Router、tRPC（`@/lib/trpc/client`）、Tailwind + Paper & Ink。

**Spec:** `docs/superpowers/specs/2026-07-03-phase5b-grid-editor-interaction-design.md`

## Global Constraints

- **无测试框架**：无测试代码。TDD 循环适配为 **实现 → typecheck → lint → 浏览器肉眼 → commit**。
- **验证命令**：`pnpm --filter @markpocket/web typecheck && pnpm lint`（均须通过）。浏览器 `http://localhost:7420`（`./dev.sh`；用有数据的 Project Tracker 表）。
- **不改后端**：无 schema/endpoint 改动。只用 `history.list({recordId, fieldId})` 与 `cell.upsert({recordId, fieldId, value})`。
- **保留 5A 结构**：`CellRenderer` 数据接口不变；grid-editor 顶部数据/mutation 逻辑不动语义。
- **Paper & Ink**：hairline `border-border`；无 shadow；选中 cell 描边 `ring-2 ring-inset ring-foreground`；编辑态输入 `bg-muted`（5A 已有）。dock：`border-l border-border bg-background`，宽 280px。
- **可 inline 编辑类型** = `text` / `number` / `date`；`boolean` 即时 toggle；其余（single-select/multi-select/user/link/attachment/expression）由控件处理，键盘 Enter 对其 no-op。
- **cn** 来自 `@/lib/utils`。

---

### Task 1: 选中态 + 2px ink 描边

grid-editor 加 `selectedCell`、可聚焦 wrapper、点击选中、选中 td 描边。开始编辑也置选中。无键盘、无 dock。

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

**Interfaces:**
- Produces（供 Task 2/3）：`selectedCell: {recordId:string; fieldId:string} | null`；`setSelectedCell`；`function selectCell(recordId:string, fieldId:string)`（置选中 + 聚焦 gridRef）；`const gridRef = useRef<HTMLDivElement>(null)`。

- [ ] **Step 1: import cn（若缺）+ 加状态与 ref**

确认 `grid-editor.tsx` 顶部有 `import { cn } from '@/lib/utils';`（若无则添加）。`useRef` 已在 `react` import 中（5A 已用于 resize）。在其它 `useState` 附近（约 96–101 行区）加：
```tsx
const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(null);
const gridRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: 加 `selectCell` 并让 `startEdit` 置选中**

在 `startEdit` 函数（约 111 行）旁加：
```tsx
function selectCell(recordId: string, fieldId: string) {
  setSelectedCell({ recordId, fieldId });
  gridRef.current?.focus();
}
```
把 `startEdit` 改为同时置选中：
```tsx
function startEdit(recordId: string, fieldId: string, current: unknown) {
  setSelectedCell({ recordId, fieldId });
  setEditing({ recordId, fieldId });
  setDraft(current == null ? '' : String(current));
}
```

- [ ] **Step 3: 包一层可聚焦 wrapper**

把 return 里的表格外层 `<div className="overflow-auto rounded-md border border-border">`（约 238 行）连同 `<table>` 一起，外面再包一个可聚焦、relative 的容器（Task 2 的 dock、Task 3 的 onKeyDown 都挂它）：
```tsx
<div ref={gridRef} tabIndex={0} className="relative outline-none">
  <div className="overflow-auto rounded-md border border-border">
    <table className="markpocket-grid border-collapse text-sm">
      {/* …不变… */}
    </table>
  </div>
</div>
```
（即在原 `overflow-auto` div 外新增一层，`</div>` 相应补齐。）

- [ ] **Step 4: cell `<td>` 点击选中 + 描边**

把 cell 的 `<td>`（约 317 行）改为：
```tsx
<td
  key={f.id}
  onClick={() => selectCell(rec.id, f.id)}
  className={cn(
    'group relative border-b border-l border-border p-0',
    selectedCell?.recordId === rec.id &&
      selectedCell?.fieldId === f.id &&
      'ring-2 ring-inset ring-foreground',
  )}
>
  {/* CellRenderer + per-cell CellHistory 块暂不动（Task 2 处理 CellHistory） */}
</td>
```

- [ ] **Step 5: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 6: 浏览器验证**

Project Tracker 表：点击任一 cell → 出现 2px 墨黑内描边；点另一 cell → 描边移动；点击 text/number/date cell 进入编辑时该 cell 也是选中态。5A 功能不回归。

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx"
git commit -m "feat(grid): cell 选中态 + 2px ink 描边

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Cell 历史 dock（替换 per-cell CellHistory）

新增右侧 dock，选中 cell 时显示历史 + restore；移除 per-cell `CellHistory` 并删除其文件。

**Files:**
- Create: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Delete: `apps/web/src/components/history/cell-history.tsx`

**Interfaces:**
- Consumes（Task 1）：`selectedCell`、`setSelectedCell`。
- Produces：`<CellHistoryDock cell field rowNumber currentValue onRestore onClose />`。
- 后端：`trpc.history.list.useQuery({recordId, fieldId})` → `Array<{id, oldValue, newValue, changedAt, changedByName, changedByEmail}>`。

- [ ] **Step 1: 写 `cell-history-dock.tsx`**

```tsx
'use client';

import { trpc } from '@/lib/trpc/client';

function fmtVal(v: unknown): string {
  if (v == null) return '(empty)';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object' && v !== null && '__error' in v) {
    return `error: ${(v as { __error: string }).__error}`;
  }
  return JSON.stringify(v).slice(0, 40);
}

function fmtTime(iso: Date | string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export function CellHistoryDock({
  cell,
  fieldName,
  rowNumber,
  currentValue,
  onRestore,
  onClose,
}: {
  cell: { recordId: string; fieldId: string };
  fieldName: string;
  rowNumber: number;
  currentValue: unknown;
  onRestore: (value: unknown) => void;
  onClose: () => void;
}) {
  const { data: history } = trpc.history.list.useQuery({
    recordId: cell.recordId,
    fieldId: cell.fieldId,
  });

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-[280px] flex-col border-l border-border bg-background">
      <div className="flex items-start justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {fieldName} · row {rowNumber}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {fmtVal(currentValue)}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded px-1 text-muted-foreground hover:text-foreground"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!history || history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes recorded.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} className="border-l-2 border-border pl-2">
              <div className="text-xs font-medium">
                {fmtVal(h.oldValue)} → {fmtVal(h.newValue)}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{h.changedByName ?? h.changedByEmail ?? 'unknown'}</span>
                <span>·</span>
                <span>{fmtTime(h.changedAt)}</span>
              </div>
              <button
                onClick={() => onRestore(h.newValue)}
                className="mt-0.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                restore
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: grid-editor 移除 per-cell CellHistory**

删除 cell `<td>` 里的历史块（约 331–333 行）：
```tsx
<div className="absolute right-0 top-0">
  <CellHistory recordId={rec.id} fieldId={f.id} />
</div>
```
并删除顶部 `import { CellHistory } from '@/components/history/cell-history';`（约 17 行）。

- [ ] **Step 3: grid-editor 渲染 dock**

在 Task 1 新增的 `<div ref={gridRef} tabIndex={0} className="relative outline-none">` 内、表格 wrapper 之后，加：
```tsx
{selectedCell &&
  (() => {
    const flat = groups.flatMap((g) => g.records);
    const rowNumber = flat.findIndex((r) => r.id === selectedCell.recordId) + 1;
    const field = displayedFields.find((f) => f.id === selectedCell.fieldId);
    const record = flat.find((r) => r.id === selectedCell.recordId);
    if (!field || !record) return null;
    return (
      <CellHistoryDock
        cell={selectedCell}
        fieldName={field.name}
        rowNumber={rowNumber}
        currentValue={record.cells[selectedCell.fieldId]}
        onRestore={(value) =>
          upsertCell.mutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value,
          })
        }
        onClose={() => setSelectedCell(null)}
      />
    );
  })()}
```
并在顶部 import：`import { CellHistoryDock } from './cell-history-dock';`

- [ ] **Step 4: 删除 `cell-history.tsx`**

```bash
git rm apps/web/src/components/history/cell-history.tsx
```
（确认无其它引用：`grep -rn "cell-history'" apps/web/src` 应只剩 dock 无关的 0 处旧引用。）

- [ ] **Step 5: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过，无悬挂 import。

- [ ] **Step 6: 浏览器验证**

选中一个 cell（如 Status 单元）→ 右侧 280px dock 滑入，显示 `字段名 · row N` + 当前值 + 历史时间线（若有），每条有 restore；点 restore 写回该值（cell 更新）；点 dock 的 × 关闭。per-cell 的时钟历史入口已消失。

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx" "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx" apps/web/src/components/history/cell-history.tsx
git commit -m "feat(grid): cell 历史 dock（替换 per-cell CellHistory）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 键盘导航

grid wrapper 承接键盘：方向键移动、Enter 编辑/toggle、Tab 右移、Esc 取消编辑/取消选中；编辑中 Enter/Tab 提交并移动。移除 CellRenderer 编辑 Input 的 `onKeyDown`。

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx`

**Interfaces:**
- Consumes（Task 1）：`selectedCell`、`selectCell`、`gridRef`、`editing`、`startEdit`、`commitEdit`、`setEditing`、`upsertCell`、`groups`、`displayedFields`。
- `FieldType` 已在 grid-editor import（5A）。

- [ ] **Step 1: 加 `moveTo` + `onGridKeyDown`（grid-editor）**

先在顶部 `react` 具名 import 里补 `type KeyboardEvent as ReactKeyboardEvent`（该文件用具名 import，无 `React` 命名空间；现有已有 `type MouseEvent as ReactMouseEvent`）。然后在 `selectCell` 之后加：
```tsx
function moveTo(r: number, c: number) {
  const flat = groups.flatMap((g) => g.records);
  const rec = flat[r];
  const f = displayedFields[c];
  if (rec && f) selectCell(rec.id, f.id);
}

function onGridKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (!selectedCell) return;
  const flat = groups.flatMap((g) => g.records);
  const r = flat.findIndex((x) => x.id === selectedCell.recordId);
  const c = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
  if (r < 0 || c < 0) return;
  const field = displayedFields[c]!;
  const rec = flat[r]!;
  const inline =
    field.type === FieldType.Text ||
    field.type === FieldType.Number ||
    field.type === FieldType.Date;
  const editingNow =
    editing?.recordId === selectedCell.recordId && editing?.fieldId === selectedCell.fieldId;
  const lastR = flat.length - 1;
  const lastC = displayedFields.length - 1;

  if (editingNow) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
      moveTo(Math.min(r + 1, lastR), c);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
      moveTo(r, Math.min(c + 1, lastC));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
    }
    return;
  }

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      moveTo(Math.max(r - 1, 0), c);
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveTo(Math.min(r + 1, lastR), c);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveTo(r, Math.max(c - 1, 0));
      break;
    case 'ArrowRight':
      e.preventDefault();
      moveTo(r, Math.min(c + 1, lastC));
      break;
    case 'Enter':
      e.preventDefault();
      if (inline) {
        startEdit(selectedCell.recordId, selectedCell.fieldId, rec.cells[selectedCell.fieldId]);
      } else if (field.type === FieldType.Boolean) {
        upsertCell.mutate({
          recordId: selectedCell.recordId,
          fieldId: selectedCell.fieldId,
          value: !rec.cells[selectedCell.fieldId],
        });
      }
      break;
    case 'Tab': {
      e.preventDefault();
      const nc = c + (e.shiftKey ? -1 : 1);
      if (nc < 0) moveTo(Math.max(r - 1, 0), lastC);
      else if (nc > lastC) moveTo(Math.min(r + 1, lastR), 0);
      else moveTo(r, nc);
      break;
    }
    case 'Escape':
      e.preventDefault();
      setSelectedCell(null);
      break;
  }
}
```

- [ ] **Step 2: 挂到 wrapper**

给 Task 1 的 wrapper 加 `onKeyDown`：
```tsx
<div ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} className="relative outline-none">
```

- [ ] **Step 3: 移除 CellRenderer 编辑 Input 的 onKeyDown**

在 `cell-renderers.tsx` 的 number / date / text（default）三处 `<Input>`，删除各自的
```tsx
onKeyDown={(e) => {
  if (e.key === 'Enter') e.currentTarget.blur();
}}
```
**保留** `onBlur={() => onCommitEdit()}`（点击别处仍提交；`commitEdit` 有 `if(!editing)return` 守卫，幂等）。

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 5: 浏览器验证**

Project Tracker 表：点选一个 cell 后——方向键在网格内移动选中（到边缘停住）；在 text/number cell 上 Enter 进入编辑，输入后 Enter 提交且选中下移一行；Tab 提交并右移；编辑中 Esc 取消编辑（保留选中）；未编辑 Esc 取消选中并关 dock；boolean cell 上 Enter 切换 ✓。dock 随选中移动更新。5A 功能不回归。

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx" "apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx"
git commit -m "feat(grid): 键盘导航（方向键/Enter/Tab/Esc）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 收尾（全部 task 后）

- [ ] 浏览器整体回归：选中/描边、键盘导航与编辑、dock 显示/restore/关闭、5A 的渲染/筛选/排序/分组/resize。
- [ ] 更新 `docs/redesign/status.md` + `docs/STATUS.md`：Phase 5 标注 5B 完成 → Phase 5 整体 ✅。commit。

## 明确不做（见 spec §9）

行/多选、复制粘贴、填充拖拽、撤销重做、restore 角色门控、打字进编辑、select 类 Enter 打开控件。
