# markpocket E2E 测试套件 — 总索引

本目录包含 markpocket v1.0.0-alpha.1 的全量测试用例，按类型分层：

## 目录结构

API 用例按域拆分（编号即执行顺序）；浏览器用例为 agent-browser YAML 场景。
**以目录中的实际文件为准** —— 下面是当前清单：

```
tests/
├── e2e/
│   ├── api/                          # API 集成测试（YAML，node tests/run-api-tests.cjs 执行）
│   │   ├── 00-auth.yaml              # 鉴权（注册/登录/会话）
│   │   ├── 01-base.yaml              # Base CRUD + 权限
│   │   ├── 02-table.yaml             # Table CRUD
│   │   └── 03-field-cell-record.yaml # Field/Cell/Record 全链路
│   │
│   └── browser/                      # 浏览器 E2E（tests/run-browser-e2e.sh 驱动 agent-browser）
│       ├── 00-auth-flow.yaml         # 登录/注册/退出
│       ├── 01-base-lifecycle.yaml    # Base 创建 → 编辑 → 删除
│       ├── 02-grid-interaction.yaml  # Grid 编辑器交互
│       ├── 03-share-flow.yaml        # 分享链接创建 → 公开页访问
│       ├── 04-invite-flow.yaml       # 邀请 → 接受 → 协作
│       ├── 05-export-history.yaml    # 导出 + 历史
│       └── 06-role-gating.yaml       # 角色权限 UI 验证
```

## 前置条件（所有测试）

- markpocket 运行在 `http://localhost:7420`（默认 dev 端口）
- Postgres 运行在 `localhost:7400`
- 已执行 `pnpm db:migrate`（所有迁移已应用）

## 测试账户

| 账户           | 邮箱             | 密码        | 角色                 |
| -------------- | ---------------- | ----------- | -------------------- |
| Alice (owner)  | alice@test.local | password123 | 测试用 Base 的 Owner |
| Bob (editor)   | bob@test.local   | password123 | 被邀请为 Editor      |
| Carol (viewer) | carol@test.local | password123 | 被邀请为 Viewer      |

## 测试数据约定

- 每个测试用例创建独立的 Base 名称（如 `E2E-Test-Base-{uuid}`），避免冲突
- 测试清理（teardown）在 `cleanup` 字段中定义，用 `register: $var` 注册中间变量
- `$ref: var_name` 表示引用之前步骤注册的变量
- `$random_uuid` 生成随机 UUID 用于唯一名称
- `$env:VAR_NAME` 引用环境变量
