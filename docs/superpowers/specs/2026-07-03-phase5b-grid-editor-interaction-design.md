# Phase 5B — Grid Editor 交互设计（Paper & Ink）

> **日期**：2026-07-03
> **范围**：Paper & Ink 重设计 Phase 5 的后半（交互）。5A（视觉）已完成。5B 加：选中态 + 键盘导航 + cell 历史 dock。
> **参考**：`docs/redesign/2026-07-01-paper-ink-design.md` §6.4（cell 历史 dock 规格）；`docs/superpowers/specs/2026-07-03-phase5a-grid-editor-visual-design.md` §10（交接）。
> **原则**：不改后端（`history.list` / `cell.upsert` 现成）。保留 5A 的数据/渲染结构；交互态由 grid-editor 持有。

---

## 1. 目标与非目标

**目标**：让 grid 有"表格感"——点击/方向键选中 cell（2px ink 描边）、标准键盘导航与编辑、右侧 cell 历史 dock（替换现有 per-cell 历史入口）。

**非目标（本 spec 不做）**：
- 行选中 / 多 cell 选中 / 区域选中
- 复制粘贴、填充拖拽、撤销重做
- restore 的角色门控（无前端角色基础设施，见 §6）
- 打字直接进入编辑（printable-char-to-edit）
- select/user/multi/link/attachment 类型的 Enter 打开控件（5B 限制：这些仍点击操作）
- 表达式列头 chip、long-text、非 grid 视图（沿 5A 非目标）
- 任何 tRPC endpoint / schema 改动

---

## 2. 现状（已核实，5A 之后）

`grid-editor.tsx`：
- 状态：`editing: {recordId, fieldId} | null`、`draft`；**无 `selectedCell`**。
- `startEdit(recordId, fieldId, current)` 设 `editing`+`draft`；`commitEdit(type, recordId, fieldId)` 提交 `draft`。
- tbody：`groups.map(g => g.records.map(rec => <tr>… displayedFields.map(f => <td><CellRenderer …/> <CellHistory recordId fieldId/></td>)))`。
- `CellRenderer`（`cell-renderers.tsx`）接口：`{ field, record, users, isEditing, draft, onDraftChange, onStartEdit, onCommitEdit, onUpsert }` —— 纯呈现，编辑输入已 `bg-muted`（5A）。

`components/history/cell-history.tsx`（65 行）：per-cell Popover，`history.list({recordId, fieldId})` → 列 `oldValue → newValue` + changedBy + time。本 spec **移除其在 grid 的使用并删除该文件**。

`history.list` 输入 `{recordId, fieldId}`；`cell.upsert` 输入 `{recordId, fieldId, value}`。均不改。

`FieldType` 10 种；可 inline 编辑（点击→Input）的是 **text / number / date**；boolean 是即时 toggle；其余（single-select / multi-select / user / link / attachment / expression）由各自控件处理，expression 只读。

---

## 3. 选中态

- grid-editor 新增 `const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(null)`。
- 点击 cell（`<td>` onClick）→ `setSelectedCell({recordId, fieldId})`。开始编辑（`startEdit`）也同时 `setSelectedCell`（编辑 ⊂ 选中）。
- 选中的 `<td>` 加 2px ink 内描边：`ring-2 ring-inset ring-foreground`（在 td 层，不进 CellRenderer）。
- grid 外层包一个可聚焦 wrapper `<div ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} className="outline-none">`；`setSelectedCell` 后 `gridRef.current?.focus()`，使键盘事件落到 wrapper。

---

## 4. 键盘导航（`onGridKeyDown`）

把可导航单元拍平：`const flat = groups.flatMap(g => g.records)`（显示顺序）；列为 `displayedFields`。当前位置 = `flat` 里 `recordId` 的 index `r` 与 `displayedFields` 里 `fieldId` 的 index `c`。

| 按键 | 未编辑（有 selectedCell） | 编辑中 |
|---|---|---|
| ArrowUp/Down | 行 ∓1（clamp [0, flat.length-1]），同列 | —（输入框默认行为） |
| ArrowLeft/Right | 列 ∓1（clamp [0, cols-1]），同行 | — |
| Enter | text/number/date → `startEdit`；boolean → `onUpsert(!value)`（即 toggle）；其余 → 无操作 | `commitEdit` 然后选中下移一行（同列） |
| Tab / Shift+Tab | 列 +1 / −1（越界则换行：到下一行第一列 / 上一行末列；clamp 到边界） | `commitEdit` 后右移一列（同 Tab 规则） |
| Escape | 清 `selectedCell`（关 dock） | 取消编辑（`setEditing(null)`，保留 selectedCell） |

- 处理键时 `preventDefault()`（方向键/Tab/Enter）以免页面滚动/焦点跳走。
- 移动后 `setSelectedCell(next)` 并保持 wrapper 聚焦。
- 边界：clamp，不 wrap（Tab 例外，见上，可跨行）。
**编辑态键盘归属（消除双触发）**：
- grid wrapper 的 `onKeyDown` 统一处理编辑中的 Enter / Tab / Escape（提交并移动 / 取消编辑），冒泡到 wrapper 后 `preventDefault`。
- **移除** `CellRenderer` 内 text/number/date `Input` 现有的 `onKeyDown`（5A 的 `Enter→e.currentTarget.blur()`）——键盘统一由 grid 层管。
- `Input` 的 `onBlur → onCommitEdit()` **保留**（点击别处 / 失焦时提交）。`commitEdit` 已有 `if (!editing) return` 守卫，故 wrapper 先 `commitEdit()`（置 `editing=null`）后随之而来的 `onBlur` 再次调用是幂等 no-op。

---

## 5. Cell 历史 dock（新 `cell-history-dock.tsx`）

**组件**：`<CellHistoryDock cell={{recordId, fieldId}} field={FieldLike} rowLabel={string} currentValue={unknown} onRestore={(value) => void} onClose={() => void} />`

- 右侧固定面板，宽 280px，`selectedCell != null` 时挂载/滑入（`border-l border-border bg-background`）。grid 主体右侧留出空间或 dock 覆盖（覆盖式，`absolute right-0 top-0 h-full`）。
- 顶部：cell 坐标（`field.name` + 行号/`rowLabel`）+ 当前值（复用 `fmtVal` 格式化）。
- 时间线：`trpc.history.list.useQuery({recordId, fieldId})` → 每条 `oldValue → newValue`、changedBy、相对时间（复用现有 `fmtVal`/`fmtTime` 逻辑，迁入本文件），最新在上。
- 每条一个 `restore` 按钮 → `onRestore(entry.newValue)`（grid-editor 里 `onRestore` = `upsertCell.mutate({recordId, fieldId, value})`）。
- 关闭：面板内 `Esc`（由 grid wrapper 处理）或点面板外 → `onClose` = 清 selectedCell。
- 空历史：`No changes recorded.`

**接入 grid-editor**：
- tbody 的 `<td>` **移除** `<CellHistory recordId fieldId/>`。
- 在 grid 容器内、`selectedCell` 存在时渲染一个 `<CellHistoryDock …/>`，`field` = 选中列、`rowLabel` = 选中行在其组内的序号或主字段值、`currentValue` = `record.cells[fieldId]`。
- 删除 `components/history/cell-history.tsx`（无其它引用）。

---

## 6. restore 权限

无前端角色门控基础设施（`base_member` 常为空，Phase 4 已记）。故 **restore 对所有已登录用户可见**；后端 `cell.upsert`（`protectedProcedure`）负责鉴权。角色门控是单独的遗留项（见 STATUS §4.2 / v2）。

---

## 7. 数据流与错误处理

- 全部沿用现有 `trpc` hooks；restore 走 `cell.upsert` → `onSuccess` invalidate `record.list`（与现有一致）+ dock 的 `history.list` 会因 realtime/invalidate 刷新。
- 键盘处理是纯前端状态；无新增查询。
- 无新增校验（后端 `normalizeCellValue`）。

---

## 8. 验收

- 点击 cell → 2px ink 描边选中；点其它 cell 移动选中。
- 方向键移动选中（边界 clamp）；Enter 进入编辑（text/number/date）/ toggle（boolean）；编辑中 Enter 提交并下移、Tab 提交并右移、Esc 取消编辑；未编辑 Esc 取消选中。
- 选中 cell 时右侧 dock 滑入：显示坐标 + 当前值 + 历史时间线 + restore；restore 写回并刷新；Esc/点外关闭。
- per-cell 历史入口已移除；`cell-history.tsx` 已删除且无悬挂引用。
- 5A 的渲染/编辑/筛选/排序/分组/resize 不回归。
- typecheck + lint 通过；浏览器肉眼验证（无自动化测试框架）。
- 无 tRPC/schema 改动。

---

## 9. 明确不做（占位/后续）

行/多选、复制粘贴、填充拖拽、撤销重做、restore 角色门控、打字进编辑、select 类 Enter 打开控件、表达式列头 chip。
