# Phase 4 — Base 详情 + Tabs 设计（Paper & Ink）

> **日期**：2026-07-02
> **范围**：Paper & Ink 重设计 Phase 4。参考 `docs/redesign/2026-07-01-paper-ink-design.md` §6.3、`docs/redesign/2026-07-01-paper-ink-plan.md` Phase 4。
> **原则**：有现成后端的真做；缺后端的留占位；本 Phase 不写 schema 迁移、不加新 tRPC endpoint。

---

## 1. 目标与非目标

**目标**：在 base 下提供一个管理中枢（Tabs：Tables / Members / Settings / History），把现有后端能力接成可用的 Paper & Ink 界面。

**非目标（本 Phase 明确不做，留占位）**：
- 邀请链接 / 邀请成员（无 invite 后端机制）
- base `description` 字段（schema 无该列，不渲染假字段）
- History base 级时间线（`history.list` 仅 cell 级 `{recordId, fieldId}`，无 base 级查询）
- 「导出全部」（`/api/export` 仅按 `tableId`）
- Tables 的行数 / 视图数聚合（避免 N+1，YAGNI）

---

## 2. 后端现状（已核实）

| 能力 | 来源 | 可用性 |
|---|---|---|
| 列出表 | `table.list({baseId})` | ✅ |
| 建表 | `table.create({baseId, name})` | ✅ |
| 成员列表 | `member.list({baseId})` → `{userId, name, email, role}` | ✅ |
| 改角色 | `member.updateRole({baseId, userId, role: owner\|editor\|viewer})` | ✅ |
| 移除成员 | `member.remove({baseId, userId})` | ✅ |
| 分享链接列表 | `share.list({baseId})` | ✅ |
| 建分享链接 | `share.create({baseId, viewId?})` → token | ✅ |
| 删分享链接 | `share.delete({id})` | ✅ |
| 重命名 base | `base.rename({id, name})` | ✅ |
| 删除 base | `base.delete({id})`（FK 级联） | ✅ |
| 按表 CSV 导出 | `GET /api/export?tableId=` | ✅ |
| base 级历史 | — | ❌ 无 |
| base 描述字段 | — | ❌ schema 无 |
| 邀请机制 | — | ❌ 无 |

---

## 3. 路由与文件结构

嵌在现有 `bases/[baseId]/layout.tsx`（PresenceBar + realtime 订阅）之下，新增：

```
apps/web/src/app/bases/[baseId]/settings/
  layout.tsx          base 头（名称 + [⋯] 菜单）+ Tabs 导航栏
  page.tsx            Tables tab（默认 index）
  members/page.tsx    Members tab
  general/page.tsx    Settings tab（route 段用 "general" 以避免 /settings/settings）
  history/page.tsx    History tab（占位）
```

- Tabs 为 route-per-tab：导航用 styled `<Link>` + `usePathname()` 判定 active（非 stateful Tabs 组件），支持深链与刷新保持。
- Tabs 顺序与标签：`Tables` / `Members` / `Settings` / `History`（`Settings` 链接指向 `general` 段）。

---

## 4. 入口

- **Sidebar**：每个 base 行 hover 显示齿轮图标 → `/bases/[baseId]/settings`。
- **空 base 页**（现有 `bases/[baseId]/page.tsx` 的建表空态）：附一个 “base settings” 链接。

---

## 5. 各 Tab 内容

### 5.1 Tables tab（`settings/page.tsx`，真做）
- `table.list({baseId})`：一行一表 —— 表名 + “打开”（→ `/bases/[baseId]/tables/[tableId]`）。
- `+ add table`：复用 `table.create`（inline input，成功后 `invalidate table.list` 就地刷新，停留在 Tables tab）。
- 空态：复用 `<EmptyState>`。

### 5.2 Members tab（`settings/members/page.tsx`，真做）
- **成员列表**：`member.list` → 每行 首字母头像（`member.list` 无 `image` 列，用 name/email 首字母，同 topbar user 头像）+ name/email + 角色 `<select>`（owner/editor/viewer，`member.updateRole`）+ “移除”（`member.remove`，确认）。
- **公开分享链接**：`share.list` → 每条 token 只读链接（`/share/[token]`，复制按钮）+ 删除（`share.delete`）；“+ 创建分享链接”（`share.create`，可选 viewId 先留空=整 base）。
- **邀请链接**：占位说明块（“邀请功能待后端支持”），不放假按钮。

### 5.3 Settings tab（`settings/general/page.tsx`，真做）
- **重命名**：input + Save（`base.rename`）。
- **导出**：`table.list` → 每表一个 CSV 导出链接（`/api/export?tableId=`）。无「导出全部」。
- **危险区**：删除 base —— 确认 dialog（复用 `ui/dialog`），确认后 `base.delete` → 跳 `/bases`。
- base 描述：不渲染（无后端字段）。

### 5.4 History tab（`settings/history/page.tsx`，占位）
- `<EmptyState>`：“coming soon —— base 级变更时间线（待后端）”。

---

## 6. 组件

- **新增** `components/settings-tabs.tsx`：Tabs 导航栏（Paper & Ink hairline 底边 + active 墨黑下划线）。
- **复用**：`ui/dialog`（删除确认）、`ui/dropdown-menu`（base [⋯] 菜单）、`ui/select`（角色）、`ui/button`、`ui/input`、`components/empty-state`、`components/online-avatars`（成员头像风格）。

---

## 7. 数据流与错误处理

- 全部走现有 `trpc.*.useQuery/useMutation`（`@/lib/trpc/client`），mutation 成功后 `utils.*.invalidate`。
- mutation 错误：就地 inline 红字（沿用 login/register 的 `text-destructive` 模式），不弹全局 toast（Toast 系统属 Phase 7）。
- 删除 base / 移除成员：确认后再执行；删除 base 成功跳 `/bases`。
- 权限：本 Phase 不做前端角色门控（viewer 也能看到按钮）；真正的权限强制在后端 procedure（v2 行/字段级权限属 P2）。UI 上可后续加禁用态。

---

## 8. 验收

- `/bases/[baseId]/settings` 显示 base 头 + 4 个 tab，active 高亮，刷新保持。
- Tables：列出表、可加表、可打开。
- Members：改角色即时生效、移除成员、公开分享链接可建/复制/删。
- Settings：重命名生效、每表可导出 CSV、删除 base 有确认并跳转。
- History：显示占位。
- typecheck + lint 通过；浏览器肉眼验证（无自动化测试框架）。

---

## 9. 明确占位清单（给后续 Phase / v2）

| 占位项 | 需要的后端 |
|---|---|
| 邀请成员 / 邀请链接 | invite token 机制 + 接受流程 |
| base 描述 | `base.description` 列 + rename/update 扩展 |
| History base 级时间线 | 新 `history.baseList({baseId})`（join cell_history→cell→record→table→base） |
| 导出全部 | `/api/export?baseId=`（多表打包） |
| 前端角色门控 | 基于 `member.list` 当前用户角色禁用/隐藏操作 |
