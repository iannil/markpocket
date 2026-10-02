# markpocket 项目状态

> **最后更新**：2026-10-02
> 本文档是项目层面的状态快照。历史版本（2026-07-02）中的多处陈述已过时
> （"无测试框架"、"公开分享未实现"、"packages/ 不存在"、"四种视图类型"等），
> 本版按当前实际状态重写。逐 commit 的功能演进见 `CHANGELOG.md` 与 git log。

---

## 1. 项目概览

markpocket 是一个面向小团队的自托管数据库（Airtable 替代品），从 teable fork 全量重写而来。

| 维度 | 状态 |
|---|---|
| 产品定位 | 单租户自托管通用数据库（Base/Table/Field/Record/View） |
| v1 核心功能 | **✅ 全部完成**（Phase 0–7） |
| Paper & Ink 重设计 | App Shell 已并入；Login/Bases/Grid 的再皮肤化为进行中（见 `docs/redesign/status.md`） |
| 技术栈 | Next.js 16 (App Router) + tRPC + Drizzle + Postgres 16 + ws |
| Dev 打包器 | **Rspack**（next-rspack）——Turbopack 有内存泄漏 |
| 部署形态 | 单 Docker Compose（web + postgres，多阶段镜像、生产依赖 only）；启动迁移由 `server.ts` 内置（pg advisory lock 防并发）；dev 拆 `next dev` + 独立 realtime 网关 |
| 插件系统 | plugin-sdk + plugin-csv + plugin-storage-local（ADR-0006..0009） |
| 测试 | vitest 单元 + 集成（**393 用例**）；tRPC 集成测试走 createCaller mock 模式（见 `docs/testing.md`） |
| CI | `.github/workflows/ci.yml`：format → lint → typecheck → test → build + **e2e job**（真实 Postgres + 生产构建 + API 场景）；release.yml 在 `v*` tag 先 verify 再发布镜像并做启动冒烟；dependabot 周更 |
| 发布状态 | 未发布到 registry，无 tagged release，master 视作 unstable |
| 许可证 | AGPL-3.0（见 LICENSE） |

---

## 2. 功能现状

| 功能 | 状态 |
|---|---|
| Base / Table / Field / Record / Grid View CRUD | ✅ |
| 视图配置（filter / sort / group / 列宽 / 隐藏列） | ✅（仅 Grid；Form/Kanban/Gallery 未实现，schema 已留位） |
| 字段类型（10 种，含 expression 写时物化 + 回填） | ✅ |
| 实时（WS + LISTEN/NOTIFY，presence，LWW 冲突 toast） | ✅ |
| cell 级历史 + base/table 级浏览 | ✅ |
| 公开分享（token → 只读单视图页面 `/share/[token]`，视图级隔离 + 隐藏字段投影） | ✅ |
| 邀请（48h token、email 匹配、角色上限 editor/viewer） | ✅ |
| CSV 导入/导出（plugin-csv，导入走核心表达式物化 + 50k 行上限） | ✅ |
| 附件（plugin-storage-local，上传白名单 + 下载 ACL；compose 以 `./data` 卷持久化） | ✅ |
| 鉴权（better-auth 密码 + 可选 OIDC；per-Base 三角色；`DISABLE_SIGNUP` 可关闭注册） | ✅ |
| 大表分页 + 虚拟滚动（`@tanstack/react-virtual`，行高 32px） | ✅ |

**安全基线（2026-10 两轮加固）**：全部读接口有角色校验（viewer 起）；写接口校验
record/field/table 归属一致性；公开分享按视图级隔离（getTables 只返回分享视图的表、
隐藏字段数据投影、视图删除即失效）；WS 频道按成员鉴权 + Origin 校验 + 心跳 + 5 分钟
成员复验/踢出/订阅限频；附件上传按 MIME 白名单、下载强制 attachment + nosniff + CSP；
CSV 导出中和公式注入；storage key 严格校验拒绝路径穿越；cell 值 256KB 上限；view
options zod 结构校验（深度/节点数/字节数）；镜像不内置 BETTER_AUTH_SECRET 且生产启动
强制校验密钥强度。

---

## 3. 已知限制 / 后续计划

- **分组跨页失真**：group 统计只覆盖当前已加载页（分页 + group 叠加时数字会变）。
- **粘贴多行展开**：向 cell 粘贴含换行的多行文本不会展开为多行/多格。
- **键盘导航不自动翻页**：方向键移到已加载边界之外时不会自动加载下一页。
- 多日期格式（TZ-aware instant 与 naive `YYYY-MM-DD` 混列）时排序按字符串比较。
- 筛选 UI 未暴露 `ne/gte/lte` 等服务端已支持的操作符。
- Form / Kanban / Gallery 视图未实现。
- **手写 SQL 无真库回归测试**：死引用清理、CSV 导入等手写 SQL 逻辑没有针对真实数据库的
  回归测试 —— CI e2e 覆盖 HTTP 层，但不覆盖这些 SQL 语义的全部分支。
- **附件 cell 无跨 base 归属校验**：attachment cell 值中手工塞入其它 base 的附件 id 时服务端
  不校验归属（交互写入需手动构造、CSV 导入跳过附件列，触发面极低）；被引用 base 删除后
  留死引用。
- **viewer 首帧布局跳变**：`member.me` 异步返回前 viewer 先按编辑者布局渲染一帧再收窄
  （纯视觉，写操作有服务端角色门禁兜底）。
- 浏览器 E2E（`tests/e2e/browser`）依赖 agent-browser CLI，未进 CI；API E2E 已进 CI
  （`ci.yml` 的 e2e job），本地用 `pnpm test:e2e-api`（需实例运行，见 `tests/e2e/README.md`）。
