# markpocket 项目状态

> **最后更新**：2026-10-01
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
| 部署形态 | 单 Docker Compose（web + postgres）；dev 拆 `next dev` + 独立 realtime 网关 |
| 插件系统 | plugin-sdk + plugin-csv + plugin-storage-local（ADR-0006..0009） |
| 测试 | vitest 单元 + 集成（120 用例，<1s）；tRPC 集成测试走 createCaller mock 模式（见 `docs/testing.md`） |
| CI | `.github/workflows/ci.yml`：lint → typecheck → test → build（push/PR）；release.yml 在 `v*` tag 构建镜像 |
| 发布状态 | 未发布到 registry，无 tagged release，master 视作 unstable |

---

## 2. 功能现状

| 功能 | 状态 |
|---|---|
| Base / Table / Field / Record / Grid View CRUD | ✅ |
| 视图配置（filter / sort / group / 列宽 / 隐藏列） | ✅（仅 Grid；Form/Kanban/Gallery 未实现，schema 已留位） |
| 字段类型（10 种，含 expression 写时物化 + 回填） | ✅ |
| 实时（WS + LISTEN/NOTIFY，presence，LWW） | ✅ |
| cell 级历史 + base/table 级浏览 | ✅ |
| 公开分享（token → 只读单视图页面 `/share/[token]`） | ✅ |
| 邀请（48h token、email 匹配、角色上限 editor/viewer） | ✅ |
| CSV 导入/导出（plugin-csv） | ✅ |
| 附件（plugin-storage-local，上传白名单 + 下载 ACL） | ✅ |
| 鉴权（better-auth 密码 + 可选 OIDC；per-Base 三角色） | ✅ |
| 大表分页（Grid "Show more"，服务端 limit 上限 1000） | ✅ |

**安全基线（2026-10 加固）**：全部读接口有角色校验（viewer 起）；写接口校验
record/field/table 归属一致性；WS 频道按成员鉴权 + Origin 校验 + 心跳；附件上传按
MIME 白名单、下载强制 attachment + nosniff + CSP；CSV 导出中和公式注入；storage
key 严格校验拒绝路径穿越；镜像不内置 BETTER_AUTH_SECRET 且生产启动强制校验密钥强度。

---

## 3. 已知限制 / 后续计划

- 无虚拟滚动：Grid 一次渲染已加载行（"Show more" 分页缓解）。
- 多日期格式（TZ-aware instant 与 naive `YYYY-MM-DD` 混列）时排序按字符串比较。
- 筛选 UI 未暴露 `ne/gte/lte` 等服务端已支持的操作符。
- Form / Kanban / Gallery 视图未实现。
- 顶层 Topbar 的在线头像（online-avatars）未接线（表级 PresenceBar 已可用）。
- 浏览器 E2E（`tests/e2e/browser`）依赖 agent-browser CLI，未进 CI；API E2E 用
  `pnpm test:e2e-api`（需本地实例运行）。
