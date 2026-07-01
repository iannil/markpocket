# markpocket 重设计：Paper & Ink 设计系统

> 本文档是 v1 收尾后的全站视觉重设计 spec。术语定义见 `../../CONTEXT.md`，关键不可逆决策的背景论证见 `../adr/`。
>
> **状态**：brainstorm 已确认，待 writing-plans 拆实施计划
> **日期**：2026-07-01
> **替代**：`apps/web/src/app/globals.css` 中的 Carbon & Citrus 调色板

---

## 1. 背景与目标

markpocket v1 功能收尾（Phase 0–7 完成：skeleton、data、views、realtime、expression、rich fields、history、CSV/share/roles）。当前视觉是 Carbon & Citrus 深色优先 + lime 强调，是开发期默认皮，不是产品级设计。

**重设计目标**：

1. 把"还行"的工具感升级到 S 级行政品质，每个页面（共 6 个）都做到位
2. 选定 Notion/Row "密集文档"美学街区作为坐标系
3. 落地"墨黑主色 · 纸感白底 · 颜色让给数据"的克制设计语言
4. 为后续（Phase 2）的差异化主题包留口：chip 表达式 hero、命令面板 hero、键盘 overlay

**非目标**：

- 不动产品功能、信息架构、领域模型（只换视觉与交互外壳）
- 不做 dark mode（token 留口，挂 `.dark` 即可）
- 不做 mobile < 1024px
- 不做完整命令面板（只占位）
- 不做"视觉差异化"主题（chip/command-palette 的 hero 化留 Phase 2）

---

## 2. 决策矩阵（已确认）

| 维度 | 决策 | 替代方案（被否） |
|---|---|---|
| 重设计动机 | 差异化定位（截图识别度） | 修 UX 痛点 / 纯焕新 |
| 美学街区 | Notion / Row（密集文档） | Linear / Playful / Dashboard |
| 识别抓手 | 交互细节（chip / palette / 键盘） | 颜色 / 结构 / Typography |
| 页面分层 | 全部 S | S/A/B 分层 / 只做 grid |
| 设计系统 | 翻转 Light-first | 进化 Carbon & Citrus / 推倍重启 |
| 强调色 | 墨黑主色（无 brand color） | 保留 lime / 换不热门色 / 颜色让给数据 |
| 结构哲学 | Document-First | Keyboard-First Tool / Grid-First |
| 差异化时机 | Phase 2 处理 | Phase 1 直接做 |

---

## 3. 五条设计支柱

1. **Paper & Ink** — 白底、墨黑、低饱和。墨黑是唯一"品牌色"
2. **Document-First** — 每页是"文档"：title + breadcrumb + tabs + content
3. **Notion-密度** — 32px 行高（Airtable 是 40px）、14px 正文（Notion 是 16px）、4px 基础间距
4. **颜色是数据属性** — UI chrome 永远中性；只有字段类型有 muted 色相
5. **Hairlines 不 shadow** — 深度靠 1px 边框；shadow 只在 popover/dialog

---

## 4. 设计系统底座：Paper & Ink

### 4.1 Color tokens

```
Light (默认)
  --background       oklch(1 0 0)          paper white
  --foreground       oklch(0.18 0 0)       ink
  --card             oklch(0.995 0 0)
  --muted            oklch(0.96 0 0)       subtle gray fill (hover/selection)
  --muted-foreground oklch(0.45 0 0)       secondary text
  --border           oklch(0.92 0 0)       hairline
  --primary          oklch(0.18 0 0)       INK = primary (按钮/选中/链接)
  --primary-foreground oklch(1 0 0)
  --destructive      oklch(0.55 0.22 27)   唯一色相，仅破坏性操作
  --online           oklch(0.65 0.15 145)  muted 绿，仅在线状态点

  /* Field-type tints —— 颜色是「数据属性」不是「品牌」 */
  --field-text       oklch(0.55 0.01 75)   warm neutral
  --field-number     oklch(0.50 0.04 250)  muted blue
  --field-date       oklch(0.55 0.05 60)   muted amber
  --field-select     oklch(0.55 0.05 330)  muted rose
  --field-link       oklch(0.55 0.04 130)  muted green
  --field-bool       oklch(0.55 0.02 200)  muted cyan

Dark (可选，不默认)
  倒置的中性灰阶，同样 0 chroma，保留 field-type tints 的色相（饱和度更低）
```

**核心规则**：UI chrome 永远中性（白 / 灰阶 / 墨黑）。除墨黑外，颜色**仅**在以下三处出现：
1. `--destructive` —— 破坏性操作（删除按钮、错误状态、`offline` 红点）
2. `--field-*` tints —— 字段类型标识（chip 左 dot、select 字段 cell dot），饱和度极低
3. `--online` 绿点 —— 协作在线状态指示

任何其它 UI 元素一律中性。Brand color 不存在，墨黑即品牌。

### 4.2 Typography

```
Sans  : Inter (system-ui 兜底)     400 / 500 / 600
Mono  : JetBrains Mono              400 / 500  ← 数据 cell、chip token、code

Scale (rem, base 16px)
  xs    0.75   cell meta、快捷键提示
  sm    0.875 cell 内容、sidebar、body（← 比 Notion 紧 2px）
  lg    1.0   page title
  xl    1.25  section header
  2xl   1.5   login/share 的 hero

letter-spacing  -0.006em  (lg+)
line-height     1.35 body / 1.2 heading / 1.25 table cell
```

### 4.3 Density

```
Spacing 4px grid:  4 / 8 / 12 / 16 / 24 / 32

Table（最关键维度）:
  row-height-default   32px   ← Airtable 是 40px
  row-height-compact   28px   (用户可切)
  header-height        36px
  cell-padding-y       4px
  cell-padding-x       10px

Sidebar:  240px 默认 / 48px 折叠成 icon rail
Page:     padding 24px × 20px
```

### 4.4 五条组件铁律

1. **Hairlines 不 shadow** —— 深度靠 `1px solid border`。shadow 只在 popover/dialog 用
2. **不全圆角** —— card/input 6px / chip 4px / table cell 0px
3. **Hover 极简** —— 只变 `bg-muted`，不变色不缩放
4. **键盘焦点环** —— `2px solid ink` offset 1px，永远可见
5. **Chip = 描边不填充** —— 透明背景 + 1px ink-tinted border，类型色只落在 chip 左 6px 圆 dot（详见 7.1）

---

## 5. 页面外壳（App Shell）

### 5.1 三层 shell

```
┌─────────────────────────────────────────────────────────────────┐
│ topbar · 40px                                                    │
│ [≡] Workspace ▸ Base ▸ Table ▸ View     🔍  [@user] [⌘K]        │
├───────────┬─────────────────────────────────────────────────────┤
│           │                                                     │
│ sidebar   │   main                                              │
│ 240 / 48  │   (page-specific)                                   │
│           │                                                     │
├───────────┴─────────────────────────────────────────────────────┤
│ statusbar · 24px                                                 │
│ ● 3 online · saved 2s ago · LWW          ↑↓ nav · ⌘K · ⌘\ sidebar│
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Topbar（40px）

- 左：sidebar 折叠按钮 `[≡]` + breadcrumb（每一节可点击，View 节是下拉）
- 中：留白（搜索归 ⌘K）
- 右：online avatars（≤3 圆 + N）· user menu · `⌘K` hint chip
- sticky，1px hairline 底边，不浮起不投影

### 5.3 Sidebar（240 / 48）

- 240 默认：workspace 名 + base 列表 + 底部固定区（members / settings / user）
- 48 折叠：icon rail，hover 弹 popover 显示名称
- 折叠状态用 localStorage `mp:sidebar` 持久化
- 当前 base 高亮：左侧 2px ink 竖条 + `bg-muted` 整行
- base 下展开 tables 二级（默认展开当前 base，其它折叠）

### 5.4 Statusbar（24px）

- 左：`● 3 online`（绿点 + 头像堆叠）· `saved 2s ago` · 冲突时显示 `LWW: <field> overwritten by @xxx`
- 右：键盘提示 `↑↓ nav · ⌘K · ⌘\ sidebar`
- 只在 base/table 页显示

### 5.5 页面变体

| 页面 | Topbar | Sidebar | Statusbar |
|---|---|---|---|
| Login / Register | ✗ | ✗ | ✗ |
| Bases 列表 | ✓（仅 "Workspace"） | ✓ | ✓（精简） |
| Base 详情 / Grid | ✓ 完整 breadcrumb | ✓ | ✓ 完整 |
| 公开分享 | 极简顶条 | ✗ | ✗ |

### 5.6 Auth 页面外壳

居中卡片，无装饰：

```
              markpocket                  ← wordmark, ink
         the airtable you own             ← sm, muted

       ┌──────────────────────────┐
       │  email                   │
       │  [________________]      │
       │  password                │
       │  [________________]      │
       │  [   sign in       ⏎ ]   │  ← ink filled
       │  — or —                  │
       │  [ continue with oidc ]  │  ← outline
       └──────────────────────────┘
```

### 5.7 公开分享外壳

```
markpocket · public        [export csv] [⤴]          ← 32px 顶条
─────────────────────────────────────────
[grid - read only, no edit affordances]
─────────────────────────────────────────
powered by markpocket                       ← 8px footer @ 40% ink
```

### 5.8 响应式

- 桌面优先，**明确推迟 mobile**
- `< 1024px`：sidebar 自动折叠成 48px rail
- `< 768px`：显示 "best on desktop" banner，允许滚动浏览（不 block）

---

## 6. 页面（6 个）

### 6.1 Login / Register

- 居中 card 360px，无 shadow（1px hairline）
- Register 多一组 confirm password，其余 1:1 复用 Login
- 错误：input 下方 1 行 ink 红字，不弹 toast、不抖动
- 演示账号：若 `BETTER_AUTH_DEMO=1`，card 下方 muted 字 `demo: demo@markpocket / demo1234`
- **不含**：forgot-password / email-verify / SSO 多租户登录（v1 不做，落到 Phase 2/3）

### 6.2 Bases 列表（`/bases`）

```
┌─────────────────────────────────────────────────────────────┐
│ Workspace                                                    │
│ 4 bases                                       [+ new base]   │
├─────────────────────────────────────────────────────────────┤
│ ◆ Customer DB                                                │
│   6 tables · 1.2k rows · 2h ago by @maya     ○○○ 3 members   │
├─────────────────────────────────────────────────────────────┤
│ ◆ Sprint tracker                                             │
│   3 tables · 240 rows · yesterday            ○○ 2 members    │
├─────────────────────────────────────────────────────────────┤
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

- 一行一个 base，72px 高
- hover 整行 `bg-muted`
- 排序：last-activity 默认，可切 name / created
- 空状态：中央 `No bases yet` + `[+ create your first base]`

### 6.3 Base 详情（`/bases/[baseId]`）

**关键决定**：进 base 默认跳第一个 table 的 grid。详情页只在「设置 / 成员 / 空 base」时显示。

- `/bases/[baseId]` → 有 tables 时 302 跳 `/bases/[baseId]/tables/[firstTableId]/grid`
- `/bases/[baseId]/settings` 显示 tabs：

```
┌─────────────────────────────────────────────────────────────┐
│ Customer DB                              [⋯] base menu       │
│ Customer-facing records, started 2026-03                    │
├─────────────────────────────────────────────────────────────┤
│ [Tables 6] [Members 3] [Settings] [History]                  │
├─────────────────────────────────────────────────────────────┤
│ ◇ Customers              1.2k rows · default grid            │
│ ◇ Orders                 340 rows  · kanban                  │
│ + add table                                                 │
└─────────────────────────────────────────────────────────────┘
```

- Tabs sticky 在 topbar 下方
- Members tab：三角色矩阵（owner / editor / viewer）+ 邀请链接 + 公开分享链接列表
- Settings tab：base 名 / 描述 / 删除 / 导出全部
- History tab：base 级变更时间线

### 6.4 Grid Editor（`/bases/[baseId]/tables/[tableId]`）—— 主场

#### 整体骨架

```
┌ topbar ─────────────────────────────────────────────────────┐
│ [≡] Workspace ▸ Customer DB ▸ Customers ▸ Grid  [⌘K] [@u]   │
├──────┬──────────────────────────────────────────────────────┤
│ side │ [Grid] [Form] [Kanban] [Gallery] [+]    [filter] [⋯] │  ← view tabs
│ bar  │ ─────────────────────────────────────────────────── │
│      │ ┌──┬──────────┬─────────┬─────────┬────────────┬───┐ │
│ base │ │  │ name  A↓ │ status  │ amount  │ total =    │ + │ │
│ list │ │  │ text     │ select  │ number  │ amount×qty │   │ │
│      │ ├──┼──────────┼─────────┼─────────┼────────────┼───┤ │
│      │ │1 │ Maya L.  │ ●Active │ 120.00  │ 144.00     │   │ │
│      │ │2 │ Li Q.    │ ●Lead   │ 80.00   │ 96.00      │   │ │
│      │ │3 │ Akira    │ ●Active │ 240.00  │ 288.00     │   │ │
│      │ │+ │          │         │         │            │   │ │
│      │ └──┴──────────┴─────────┴─────────┴────────────┴───┘ │
├──────┴──────────────────────────────────────────────────────┤
│ ● 3 online · saved 2s ago                  ↑↓ nav · ⌘K       │
└──────────────────────────────────────────────────────────────┘
```

#### grid 单元细节

| 元素 | 规格 |
|---|---|
| 行号 | 灰色 `--muted-foreground`，右 1px hairline，点击选中整行 |
| 列头 | 36px 高；第一行字段名（500 weight），第二行字段类型 + 排序/筛选状态 |
| 表达式列头 | 第二行渲染为 chip 序列（`[amount] × [qty]`），不是文本 |
| 单元格垂直对齐 | 顶部对齐 |
| 单元格 padding | 4px × 10px |
| 选中 cell | 2px ink 描边，内嵌 |
| 编辑中 cell | `bg-muted`，光标色 = ink |
| 空值 cell | 极淡 `—` 占位 |
| 新增行 ghost | 整行虚线 hairline + `+` 居中，hover 实线 |
| 新增列 ghost | 右侧 32px 宽灰条 + `+` |

#### cell 类型渲染（11 种）

- **text** — 左对齐，sans，空 → `—`
- **long-text** — 单行截断 + 右侧迷你 `⟼` icon
- **number** — 右对齐，mono，tabular-nums；负数 ink 红
- **boolean** — `✓` ink 或空白（不用 checkbox 形）
- **date** — mono `2026-07-01`；相对今天则 muted `today` / `yesterday`
- **single-select** — 左 6px dot（field-select 色）+ 文字
- **multi-select** — 最多 2 个 chip + `+N` 灰字
- **attachment** — 缩略图 24×24 圆角 4px；多于 1 个堆叠
- **user** — avatar 20×20 + 名字
- **link** — 另一表 record 的标题；hover 出 popover 预览；`⌘+点击`跳转
- **expression** — materialized 值（按结果类型渲染）；左 2px ink 竖条标识"计算字段"

#### 右侧 cell 历史 dock

- 默认隐藏；选中 cell 时从右滑入，宽 280px
- 顶部：cell 坐标（`B2`）+ 当前值
- 时间线：`时间 · 操作者 · 旧值 → 新值`，最新在上
- 底部：`restore this value`（仅 owner/editor 可见）
- 关闭：`Esc` 或点 dock 外

### 6.5 公开分享（`/share/[token]`）

- 顶条多一行 view 切换器（如果分享范围是 "all views"，tabs 可点击；只读范围则 disabled）
- 不显示 members、history dock、statusbar
- grid 顶上 pill：`Read-only · powered by markpocket`；owner 可在 share 设置勾 "hide branding"

### 6.6 404 / 500 / loading

- **404** — 居中 `Not found` + `← back to workspace`，无图
- **500** — 居中 `Something broke` + request id（mono 小字）+ retry 按钮
- **Loading** — 顶部 1px ink 横条进度条，悬浮在 topbar 下沿

---

## 7. 组件模式

### 7.1 Chip 系统

四类 chip，长得不一样：

```
字段引用 chip（表达式里）:
  ┌──────────────┐
  │ ● amount     │   1px ink border, transparent bg
  └──────────────┘   4px radius, 22px tall
                     左 6px dot = field-type tint
                     label = mono 12px

multi-select chip（cell 里）:
  ╭──────────╮
  │  Lead    │       ink-tinted bg (--muted), no border
  ╰──────────╯         4px radius, 20px tall, sans 12px

filter chip（filter bar 里）:
  ┌─────────────────────────────┐
  │ status  is  Active    ✕     │   1px border, 26px tall
  └─────────────────────────────┘     三段式（field op value）+ remove

status dot（select 字段 cell 里）:
  ● Active              只有 dot + text，无 chip 形
```

铁律：chip 永远不填充 brand color（因为没有 brand color）。

### 7.2 浮层 vs 内联 vs 抽屉

| 模式 | 用途 | 例子 |
|---|---|---|
| **Popover** | 锚点相关的轻量操作 | cell 编辑、字段配置、view 切换、filter builder |
| **Modal** | 中断式、需要确认 | 删除 base、CSV 导入预览、权限变更 |
| **Drawer** | 多步配置、不挡主区 | base 设置、成员管理、cell 历史（窄版） |
| **Inline** | 不打断上下文 | cell 编辑（grid 内）、base 重命名、列宽 |

规则：**能 inline 就不 popover；能 popover 就不 modal；能 modal 就不 drawer**。

### 7.3 命令面板（Phase 2 占位）

- 全局 `<CommandPalette>` 组件挂上，注册三条命令：`Search bases` / `Search tables` / `Quick actions menu`
- 触发：`⌘K`
- Phase 1 行为：搜索框可输入，结果空时显示 `Search ready · full index in v2`
- topbar / statusbar 露 `⌘K` hint，培养肌肉记忆

### 7.4 空 / 加载 / 错误 三态

**空状态**：最多两行文案 + 一个 primary action，无插画

**加载**：
- 页面切换：topbar 下沿 1px ink 横条（indeterminate，2s 循环）
- grid 数据：骨架屏，5 行 ghost（`bg-muted` + shimmer），不旋转 spinner
- cell 写入：cell 右上角 8px 半透明 ink 圆点闪烁，2s 后变 `saving…`
- 按钮提交：button 内文字替换为 ink-tinted `···`

**错误**：
- 表单验证：input 下方 1 行 ink 红字
- cell 写入失败：cell 描边变 ink 红，hover 显示错误
- 页面级 500：见 6.6
- 网络断开：statusbar 左侧 `● offline`（红点）

### 7.5 Toast

- 位置：右下，距视口边缘 16px
- 尺寸：320px 宽，48px 高
- 时长：4s，hover 暂停
- 范围：**只**用于"操作成功"反馈（saved / deleted / exported / invited）
- **不**用于：错误（用 inline）、验证（用 inline）、信息提示（用 statusbar）

### 7.6 输入控件

| 元素 | 规格 |
|---|---|
| input / textarea / select | 32px 高（compact 28px），6px radius，1px ink-tinted border |
| focus | 2px ink 描边 offset 1px |
| error | border 变 `--destructive`，下方 1 行红字 |
| disabled | `bg-muted` + 文字 50% opacity |
| primary button | ink filled, white text, 6px radius, 32px 高 |
| secondary button | outline 1px ink, transparent bg |
| destructive button | outline `--destructive` + 红字（不填充） |
| icon button | 32×32 square, transparent, hover `bg-muted` |

### 7.7 键盘快捷键（v1 范围）

```
全局
  ⌘K        命令面板（Phase 2 完整）
  ⌘\        折叠/展开 sidebar
  ⌘/        显示快捷键帮助 overlay

grid
  ↑↓←→     移动选中 cell
  Enter     进入编辑 / 下一行
  Esc       取消编辑
  Tab       下一 cell
  Shift+Tab 上一 cell
  ⌘C ⌘V     复制/粘贴 cell 值
  Backspace 清空选中 cell（非编辑态）

文本编辑
  ⌘Enter    提交表单
  ⌘S        手动保存（视觉反馈，实际自动保存）
```

Phase 1 不做：vim 模式、自定义映射、命令面板完整功能。

### 7.8 头像 / 成员呈现

- 头像：20 / 24 / 32 px 三档，圆角 50%
- 无图：ink-tinted bg + initials（mono），每人 hash 一个稳定的 muted 色
- 堆叠：`-8px` overlap，最多 3 个 + `+N`
- 在线：右下 4px 绿点（唯一允许的非中性色之一，标识在线状态）

---

## 8. 构建顺序

| 阶段 | 工期 | 内容 |
|---|---|---|
| 0 | 0.5d | 设计 token 落地：重写 `globals.css`，Paper & Ink 调色板 + scale + density tokens + field-type tints |
| 1 | 1d | App Shell：`<AppShell>` 组件 + topbar + sidebar（折叠） + statusbar |
| 2 | 0.5d | Login / Register：居中 card、inline 错误 |
| 3 | 0.5d | Bases 列表：list 布局、空状态 |
| 4 | 0.5d | Base 详情 + Tabs：redirect 逻辑、Tables/Members/Settings/History |
| 5 | 3d | Grid Editor（4 步：骨架与表头 / cell 类型渲染 / inline 编辑 + 键盘 / cell 历史 dock） |
| 6 | 0.5d | 公开分享：极简 shell + 只读 grid |
| 7 | 0.5d | 收尾：404/500/loading、Toast、⌘K 占位、截图存档 |
| **合计** | **7d** | |

每阶段独立 commit、独立 review、可回滚。

---

## 9. 不在本设计内（明确推迟到 Phase 2）

- Dark mode（token 已留口）
- 命令面板完整功能（搜索索引、所有 actions、自定义命令）
- Mobile < 1024px 适配
- 可视化差异化主题包（chip 表达式 hero 化、命令面板 hero 化、键盘 overlay）
- Cell-level 实时协作光标（看到别人选了哪个 cell）

---

## 10. 后续

本 spec 经 brainstorm 确认后，由 writing-plans skill 拆解为逐阶段实施计划。每个阶段对应一份独立可 review 的 PR。
