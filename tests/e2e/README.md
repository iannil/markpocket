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
│   │   ├── 03-field-cell-record.yaml # Field/Cell/Record 全链路
│   │   └── 04-disable-signup.yaml    # DISABLE_SIGNUP=1 场景（可选，默认跳过，见下）
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
- **没有自动清理（teardown）机制**：runner 不实现 `cleanup` 字段，测试产生的资源会留在数据库中（因此全部用随机唯一命名，重跑不冲突）。重复跑完整套件前建议重置数据库
- `register: $var` 在步骤上注册中间变量，供后续步骤引用
- `no_auth: true`（步骤级字段）：该步骤**不携带**会话 cookie 发送（runner 的 authCookie 会粘滞到后续用例，"未认证"类用例必须显式声明）
- `$ref: var_name` 表示引用之前步骤注册的变量
- `$random_uuid` 生成随机 UUID 用于唯一名称
- `$response.body[.result.data].path...` 在 `register` 里引用当前步骤响应的全路径（支持 `.` 与 `[N]`）
- `$env:VAR_NAME` 引用 runner 进程的环境变量
- **变量解析 fail-loud**：`$ref:`/`$env:`/`$response.body...` 引用解析不到时直接报错（`Unknown variable reference`），不会静默落成字面量字符串（与 `Unknown assert` 的 fail-loud 哲学一致）
- **断言操作符白名单**：仅支持 `==` / `!=` / `contains` / `startswith` / `endswith`（如 `$status == 200`、`$response.body.result.data[0].name == Grid`）。`===` / `!==` 直接报 `Unknown assert`（fail-loud）——历史上它们曾被正则吞成 `!=` 且期望值偏移为 `= y` 而恒真（假绿），现在在匹配前显式拒绝；其余未知断言语法同样抛 `Unknown assert`
- `requires_env: VAR_NAME`（用例级字段，也接受数组 `[VAR1, VAR2]`）：仅当列出的环境变量**全部**为真值（空串与 `0/false/no/off` 视为缺）时执行本用例，否则记为 SKIP。用于需要特殊服务端配置的场景（如 `04-disable-signup.yaml`：前两例需要服务端 `DISABLE_SIGNUP=1` 且 runner 侧设置 `DISABLE_SIGNUP_TESTS=1`；第三例需要 `E2E_EXISTING_EMAIL` + `E2E_EXISTING_PASSWORD`）

## BASE_URL

runner 默认指向 `http://localhost:7420`（dev.sh 端口）。目标不同时用 `BASE_URL` 覆盖（请求头里的 `Origin` 会从 `BASE_URL` 推导，服务端的 Origin 校验依赖它）：

```bash
BASE_URL=http://localhost:3000 node tests/run-api-tests.cjs
```
