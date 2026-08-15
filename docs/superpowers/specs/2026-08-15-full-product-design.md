# markpocket v1 全功能产品路线图设计

> **日期**：2026-08-15
> **状态**：Draft
> **目标**：从当前状态到 v1 功能完备发布的完整产品路线图

## 目标用户

- **小团队协作（主）**：3-20 人团队内部工具，替代 Airtable 付费订阅。优先：实时协作、角色权限、分享、导入导出、稳定性。
- **开发者工具 / 开源社区（辅）**：面向开发者生态，作为可自托管的开源组件。优先：API、插件生态、定制性、文档。

## 发布定义

**"功能完备"发布**：补齐所有 v1 候选功能（公开分享完整链路、Grid 交互增强、邀请机制、角色权限、导出全部、历史回溯、基础优化），才认为是 v1 可发布。

---

## 路线图全景

```
Phase A (P0)       Phase B (P1)       Phase C (P2)
┌───────────────┐  ┌──────────────┐   ┌────────────────┐
│ 最后一公里     │  │ 协作与发布   │   │ 开发者体验      │
│               │  │              │   │                │
│ · 公开分享    │  │ · 邀请机制   │   │ · 测试基础设施  │
│ · Grid 交互   │  │ · 导出全部   │   │ · 贡献指南      │
│ · 历史回溯    │  │ · 发布流程   │   │ · 插件开发文档  │
│ · 基础优化    │  │              │   │ · API 文档      │
│               │  │              │   │                │
│ ~3 周         │  │ ~3 周        │   │ ~4 周          │
└───────────────┘  └──────────────┘   └────────────────┘
                         ↓
                    v1.0.0 发布
```

### 依赖关系

- A1（公开分享）依赖现有 `base_share` 表 → 独立可做
- B1（邀请）依赖 B1 本身的权限矩阵 → 互相依赖
- C1（测试）中分享/权限测试依赖 A1 + B1 完成，但核心单元测试可先行
- A2（Grid 增强）独立，可并行
- 每个 Phase 结束都是一个可发布的小版本

---

## Phase A — 最后一公里（P0，~3 周）

### A1. 公开分享

**现状**：
- ✅ `base_share` 表（token、baseId、viewId、expiresAt）已存在
- ✅ `share.create` / `share.list` / `share.delete` tRPC 后端已做
- ❌ 无 `/share/[token]` 公开页面
- ❌ 无 public 的按-token 读取端点
- ❌ Members tab 生成的链接 404

**设计**：

#### 数据模型
`base_share` 表补充 `createdBy` 字段（text，nullable），用于展示"谁创建的分享"。

#### 公开只读端点（新 tRPC router 或独立路由）

```
GET /api/public/share/[token]              → base 元信息（名称、图标）
GET /api/public/share/[token]/table/[tableId]  → 按 viewId 限定的表数据
```

- 不经过鉴权中间件，独立处理
- 验证流程：token 存在性 → 检查 expiresAt → 用 share 里的 viewId 圈定数据范围
- 返回数据：表名、字段列表（含类型）、记录列表（含 cell 值）、视图配置

#### 公开页面 `/share/[token]`

- 无 AppShell / 无鉴权
- 只读 Grid（复用 CellRenderer 的只读渲染模式）
- 展示 Base 名 + Table 名 + "以共享视图形式查看"
- 无编辑入口、无实时（只读快照，不做 WebSocket）
- 过期提示页（"此分享链接已过期"）
- 视图类型支持：Grid 为主，Form/Kanban/Gallery 至少渲染基本只读形态

#### 错误处理

| 场景 | 处理 |
|------|------|
| token 无效 | 404 页面 |
| 分享已过期（expiresAt 已过） | 410 Gone 语义的过期提示页 |
| 分享被删除 | 404 页面 |
| viewId 指向不存在的视图 | 降级为显示全部表数据 |

---

### A2. Grid 交互增强

**现状**：Paper & Ink 重设计已完成 Grid 编辑器视觉（5A）和基础交互（5B），但表达式列头 chip、行多选、复制粘贴、dock 关闭等未完成。

**设计**：

#### 表达式列头 chip
- 表达式字段的列头显示表达式内容（如 `单价 × 数量`）为可读 chip
- 悬停 tooltip 显示完整表达式
- 双击 chip 进入表达式编辑（复用现有 expression-eval 的 token 编辑）

#### 行号点击 = 全选行
- 点击行号 → 选中整行（高亮背景）
- Shift 连续选行、Cmd/Ctrl 点选不连续行
- 选中的行有视觉反馈（行高亮）

#### 多选区域复制粘贴
- 选中区域复制（行列矩形）→ 剪贴板 Tab 分隔 + 换行分隔
- 粘贴时：目标区域足够则逐格填，不够则提示
- 初始只支持纯文本粘贴（不是单元格格式）

#### Cell History dock 关闭体验
- 点击 dock 外部区域关闭
- Esc 键关闭
- 保持 dock 底部 slide-up 面板样式

#### 不做的（留到 Phase B 或 v2）
- 撤销/重做（需要命令模式 + 历史栈，复杂度高）
- 拖拽行重排序
- 批量删除行

---

### A3. 历史回溯

**现状**：cell_history 追加写 + 时间轴 UI dock 已做，但缺少全局视角。

**设计**：

#### Base 级时间线

新建 `/bases/[baseId]/history` 页面（替换 Settings 里的 History tab 占位）：
- 展示该 Base 下所有表的所有变更，按时间倒序排列
- 每行：谁、什么时间、改了哪个 Record 的哪个 Field、旧值→新值
- 分页（默认 50 条/页，支持翻页）
- 过滤器：按用户、按表、按字段类型

#### Cell 级历史增强
- 当前 cell history dock 已实现基础时间轴
- 补：支持"恢复到历史版本"（点击某条历史 → 确认恢复 → 写入新值并追加一条恢复记录）
- 补：diff 视图 —— 一键对比当前值与选中历史值的差异

#### 后端补充
- 当前 `cellHistory.list` 可能只支持单 cell 查询
- 补：`cellHistory.listByBase` - 按 baseId 遍历所有表和 cell 的历史
- 补：`cellHistory.listByTable` - 按 tableId 限制范围

#### 不做的
- 按时间点"回滚整个 Base"（需要事务级快照，复杂度高，v2 候选）

---

### A4. 基础优化

#### Toast 系统全面接线
- 当前：自造最小 Toast 组件已就位，但只有 3 处演示接线
- 补：所有 mutation（创建/更新/删除 base、table、field、record）成功后显示成功 Toast
- 补：所有 mutation 失败时显示错误 Toast（含具体错误信息）
- 补：分享链接创建成功时 Toast + 自动复制链接

#### ⌘K 命令面板填充
- 当前：占位实现（cmdk 已安装，面板能打开但无命令）
- 补：全局命令 —— "创建 Base"、"切换到 Base X"、"搜索表"、"打开设置"
- 补：上下文感知 —— 在 Base 详情页时增加"创建表"、"管理字段"等命令

#### Loading / Empty / Error 状态覆盖
- 当前：404/500 页已做，但很多页面缺少 loading spinner 和 empty state
- 补：所有 tRPC 查询的 loading 态（Skeleton 组件）
- 补：所有列表的 empty state（"没有表，创建一个"等）
- 补：所有 mutation 的 error 态（Toast + 行内错误提示）

---

## Phase B — 协作与发布（P1，~3 周）

### B1. 邀请机制

**现状**：✅ `base_member` 表 + 三层角色已定义，但无邀请流程，Members tab 是占位。

#### 数据模型

新建 `base_invite` 表：

```sql
base_invite (
  id          text PRIMARY KEY,
  base_id     text NOT NULL REFERENCES base(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'editor',  -- owner | editor | viewer
  token       text NOT NULL,
  invited_by  text,                            -- user id
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,                     -- nullable
)
```

同一 email 可被多次邀请但只保留最新有效的一条（去重逻辑在创建时）。

#### 邀请流程

1. Owner 在 Members tab 输入 email + 选择角色 → 生成邀请链接 `[baseUrl]/invite/[token]`
2. 链接自动复制到剪贴板（自托管无邮件服务，用链接分享代替 SMTP）
3. 受邀者打开链接：
   - 已登录 → 直接接受邀请 → 加入 Membership → 跳转到 Base
   - 未登录 → 跳转注册/登录 → 登录后自动接受邀请 → 跳转到 Base
4. Owner 可取消邀请（删除/使链接失效）
5. 邀请链接默认 48h 过期

#### 角色权限矩阵

| 操作 | owner | editor | viewer |
|------|-------|--------|--------|
| 查看 Base / 表 / 记录 | ✅ | ✅ | ✅ |
| 编辑单元格 | ✅ | ✅ | ❌ |
| 增删记录 | ✅ | ✅ | ❌ |
| 建表 / 改字段 | ✅ | ✅ | ❌ |
| 管理成员 / 邀请 | ✅ | ❌ | ❌ |
| 删除 Base | ✅ | ❌ | ❌ |
| 创建分享链接 | ✅ | ✅ | ❌ |

#### 前端角色门控
- 所有 mutation（创建/更新/删除）按角色禁用 UI 入口（按钮置灰/隐藏）
- 后端 tRPC middleware 校验角色（双重防护，不能只靠前端）
- 非成员访问 → 403

---

### B2. 导出全部

**现状**：✅ CSV 导入导出插件已实现，但只支持单个表导出。

#### Base 级导出
- 新建入口（Base 详情页或 Settings）
- 选择要导出的表（多选，默认全选）
- 导出格式：每个表一个 CSV 文件，打包成 ZIP
- 复用现有 `plugin-csv` 的 `exportTableToCsv` 逻辑

#### 导出选项
- 字段选择：导出全部字段 / 仅可见字段
- 视图选择：按视图导出（应用 filter/sort/group 后的结果）
- 包含/排除表达式字段（物化值 vs 不导出）

#### 技术实现
- 后端：`plugin-csv` 新增 `exportBase` 接口，返回 ZIP buffer
- 前端：下载触发 → 浏览器下载 ZIP
- 大 Base 导出：流式处理，显示进度条

---

### B3. 发布流程

**现状**：Docker Compose 生产配置已就绪，无 tagged release，master 标记为 unstable。

#### 版本号与发布策略
- 语义化版本 (SemVer)：`v1.0.0-alpha.1` → `v1.0.0-beta.1` → `v1.0.0`
- Phase A 完成 → `v1.0.0-alpha.1`
- Phase B 完成 → `v1.0.0-beta.1`
- 稳定运行 2 周后 → `v1.0.0`
- 单次发布 = 一个 git tag + GitHub Release

#### 文档
- 更新 `README.md` 加入升级指南
- 新增 `CHANGELOG.md`：记录每次 release 的变更
- 新增 `docs/UPGRADE.md`：数据库迁移注意事项

#### Docker 镜像发布
- GitHub Container Registry (ghcr.io) 发布
- 自动构建：打 tag 时自动构建多架构镜像（linux/amd64 + linux/arm64）
- 版本标签：`v1.0.0-alpha.1`、`latest`（仅稳定版）

#### 发布检查清单
- [ ] 所有 Phase A + B 功能完成
- [ ] 数据库迁移脚本通过（无破坏性变更）
- [ ] 手动端到端验证（创建 Base → 建表 → 填数据 → 分享 → 邀请 → 导出）
- [ ] docker-compose up 一键启动验证
- [ ] 从上一个版本升级（空数据库）验证
- [ ] CHANGELOG 更新
- [ ] README 更新

---

## Phase C — 开发者体验（P2，~4 周）

### C1. 测试基础设施

**现状**：项目有 vitest 配置和少量测试文件，覆盖度低。

#### 测试策略金字塔

```
单元测试 (覆盖 80%+ 核心逻辑)
├── field-value.ts (已部分覆盖)
├── expression-eval.ts (当前无测试)
├── view-query.ts (当前无测试)
├── roles.ts / 权限校验 (当前无测试)
└── 所有 utility 函数

集成测试 (覆盖所有 tRPC router)
├── base.ts, table.ts, field.ts
├── record.ts, cell.ts, view.ts
├── share.ts (新建), history.ts (新建)
└── member.ts (新建)

E2E 测试 (Playwright 已安装)
├── 登录 → 创建 Base → 建表 → 填数据 → 导出
├── 邀请成员 → 协作编辑 → 查看历史
└── 创建分享链接 → 公开页访问
```

#### tRPC router 集成测试模式
- 使用 `createCallerFactory` 创建 tRPC server caller（`caller.ts` 已存在）
- 测试前：创建测试数据库（或事务回滚）
- 测试后：回滚事务
- 每个测试使用独立的 base/table/record ID 避免冲突

#### 优先级
- **P0**: 核心数据路径单元测试（expression-eval、view-query、field-value）
- **P0**: tRPC router 集成测试（base、table、field、record、cell）
- **P1**: 权限/角色测试（与 Phase B 邀请功能一起做）
- **P1**: 分享/公开页测试（与 Phase A 公开分享一起做）
- **P2**: E2E 测试

---

### C2. 贡献指南

#### `CONTRIBUTING.md`
- 开发环境搭建（`./dev.sh`）
- 代码规范（Prettier + ESLint + tsc --noEmit）
- PR 流程（分支策略、commit message 规范、review 要求）
- 架构决策规则（"没有新子系统不写 ADR"）
- 领域术语（引用 CONTEXT.md）

#### Issue / PR 模板
- GitHub Issue 模板：Bug report / Feature request
- GitHub PR 模板：变更摘要、测试清单、ADR 引用

---

### C3. 插件开发文档

#### `docs/plugin-development.md`
- 插件 SDK 快速入门（`@markpocket/plugin-sdk`）
- 6 个扩展点详解（storage / fieldType / viewType / uiSlot / event / authProvider）
- 完整示例：从零写一个 CSV 插件
- `plugins.config.ts` 注册流程
- Server Router 注入（`CoreServerApi` + `ServerRouterFactory`）

#### `packages/plugin-sdk/README.md`
- API 参考
- TypeScript 类型导出

---

### C4. API 文档

#### `docs/api/` 目录
- 每个 tRPC router 的输入/输出类型和说明
- 初期手动维护（tRPC 的端到端类型就是天然文档）
- 关键数据流图（"创建一条记录发生了什么"）

---

## 附录：不做事项（v2 候选）

以下功能明确不在 v1 范围内，留作 v2 候选：

| 功能 | 原因 |
|------|------|
| Lookup / Rollup 字段 | 需要跨表查询引擎，复杂度高 |
| Calendar 视图 | 与 Grid/Form/Kanban/Gallery 正交 |
| S3 storage adapter | 已有本地 FS 存储，S3 可按需通过插件扩展 |
| Redis pub/sub 多实例 | 单租户自托管在一台机器上跑，不需要多实例 |
| 撤销/重做 | 需要命令模式 + 历史栈，复杂度高 |
| 拖拽行重排序 | 无后端支持，需要追加 orderIndex |
| 批量删除行 | 依赖行多选（Phase A 做选行，但批量删除留 v2） |
| 行/字段级权限 | 当前只有 Base 级角色，细粒度权限复杂度高 |
| 公式/计算字段进化 | 当前 Expression Field 仅限单行物化 |
| i18n | 单一语言 MVP 发布优先 |
| AI 功能 | 明确不在 v1 范围内 |