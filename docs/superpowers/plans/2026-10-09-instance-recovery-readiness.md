# Instance Recovery Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供能在隔离实例证明 DB、附件、权限与历史可恢复的备份操作流程，并形成发布候选验收证据。

**Architecture:** 继续使用 Docker Compose 的 web/postgres 与本地 data 目录。用一个短 shell 脚本暂停应用写入、生成数据库和附件备份；恢复使用独立 Compose 工程与空卷，操作手册明确逐步验证，不自动覆盖现有部署。

**Tech Stack:** Bash、Docker Compose v2、PostgreSQL 16 工具、tar、shasum、Node >=22。

**Spec:** `docs/superpowers/specs/2026-10-09-airtable-opportunity-design.md`，A2/O1–O5。

## Global Constraints

- Node >=22；pnpm 10.32.1；PostgreSQL 16；沿用 Next.js 16、tRPC 11、Drizzle、Vitest。
- 单租户自托管；不引入多租户、计费系统、任务队列或新运行时依赖。
- 不改 ADR-0001/0003/0004 的规模、Expression Field 与部署边界。
- 插件不得导入应用的 @/ 路径；通过 CoreServerApi 注入主机能力。
- 所有导出至少要求 viewer 权限；错误不得返回部分文件或泄露数据库信息。
- CSV 是数据交换格式，不是完整备份；附件二进制、权限、历史通过实例备份保存。
- 保留用户已有的 .gitignore 修改与 CLAUDE.md 删除；不恢复、不提交这些变更。
- 仅编写计划不代表已实施、测试通过或发布；执行计划不自动授权推送 tag 或发布镜像。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `scripts/backup-instance.sh`（新建） | 检查输入、停写、导出、校验、恢复 web 原状态 |
| `docs/BACKUP.md`（新建） | 备份限制、隔离恢复命令、验收清单与失败处置 |
| `docs/release/2026-10-09-recovery-evidence.md`（执行时新建） | 实际恢复证据；从未执行状态开始，不预填通过 |
| `docs/README.md`、`README.md`、`README.zh.md`、`docs/UPGRADE.md` | 指向新的备份/恢复手册 |

本计划可与 CSV 子项目分别实施；发布候选验收须等两者合入。仅支持当前本地 storage adapter；不自动备份 S3 或外部插件存储。管理员应确保不存在直连数据库的外部写入者，否则停 web 不足以形成 DB/附件一致备份。

## Task 1：可失败恢复的实例备份

**Files:** 新建 `scripts/backup-instance.sh`；`docs/BACKUP.md`。

**Interfaces:**
- Consumes: `backup-instance.sh INSTANCE_DIRECTORY NEW_BACKUP_DIRECTORY`；实例目录含 `docker-compose.yml` 与 `.env`，postgres 运行中；`data/` 是当前附件目录。
- Produces: `database.dump`、`data.tar.gz`、`manifest.txt`、`SHA256SUMS`、`COMPLETE`。只有含 COMPLETE 且校验通过的目录才可恢复。输出目录必须事先不存在。

- [ ] **Step 1：记录真实验收场景。** 在 BACKUP.md 写入：参数缺失失败；目标已存在失败且不停止 web；pg_dump 失败时原运行 web 重启且无 COMPLETE；web 本来停止时不主动启动；含附件实例成功备份与恢复。这些使用 Task 2 的一次性实例验证，不为 shell 命令调用次数写 mock 测试。
- [ ] **Step 2：编写备份脚本。** 以下为完整脚本。不要启用 shell xtrace；它可能输出环境和凭据。

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
if [ "$#" -ne 2 ]; then
  echo 'Usage: backup-instance.sh INSTANCE_DIRECTORY NEW_BACKUP_DIRECTORY' >&2
  exit 2
fi
instance_dir=$(cd "$1" && pwd -P)
backup_input=$2
case "$backup_input" in /*) ;; *) backup_input="$PWD/$backup_input" ;; esac
backup_parent=$(cd "$(dirname "$backup_input")" && pwd -P)
backup_dir="$backup_parent/$(basename "$backup_input")"
[ -f "$instance_dir/docker-compose.yml" ] || { echo 'Missing docker-compose.yml' >&2; exit 2; }
[ -f "$instance_dir/.env" ] || { echo 'Missing .env' >&2; exit 2; }
[ ! -e "$backup_dir" ] || { echo 'Backup destination already exists' >&2; exit 2; }
case "$backup_dir/" in "$instance_dir/data/"*) echo 'Backup destination cannot be inside data' >&2; exit 2 ;; esac
cd "$instance_dir"
compose=(docker compose --project-directory "$instance_dir" -f "$instance_dir/docker-compose.yml")
"${compose[@]}" exec -T postgres pg_isready -U markpocket -d markpocket >/dev/null
mkdir "$backup_dir"
was_running=0
if "${compose[@]}" ps --status running --services | grep -qx web; then was_running=1; fi
cleanup() {
  result=$?
  trap - EXIT
  if [ "$was_running" = 1 ]; then
    if ! "${compose[@]}" start web; then
      echo 'Backup finished but web restart failed; start web manually.' >&2
      result=1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
if [ "$was_running" = 1 ]; then "${compose[@]}" stop web; fi
"${compose[@]}" exec -T postgres pg_dump -U markpocket -d markpocket \
  --format=custom --no-owner --no-acl > "$backup_dir/database.dump"
if [ -d data ]; then
  tar -czf "$backup_dir/data.tar.gz" -C data .
else
  tar -czf "$backup_dir/data.tar.gz" -T /dev/null
fi
{
  echo 'format=markpocket-instance-backup-v1'
  echo 'postgres_major=16'
  echo 'storage=local'
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=${MARKPOCKET_SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unversioned)}"
  if [ -f package.json ]; then
    node -e 'const fs=require("fs"); console.log("version="+JSON.parse(fs.readFileSync("package.json","utf8")).version)'
  fi
  "${compose[@]}" images -q web | sed 's/^/web_image=/'
} > "$backup_dir/manifest.txt"
(
  cd "$backup_dir"
  shasum -a 256 database.dump data.tar.gz manifest.txt > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
  : > COMPLETE
)
echo "Backup ready: $backup_dir"
```

- [ ] **Step 3：校验语法并执行失败前置条件。**

```bash
chmod +x scripts/backup-instance.sh
bash -n scripts/backup-instance.sh
bash scripts/backup-instance.sh
```

最后一条预期 exit 2，仅 Usage；不接触容器。在一次性实例上用已存在目录作为第二参数，预期 exit 2，`docker compose ps` 的 web 不变。真正 pg_dump/恢复测试放在 Task 2。

- [ ] **Step 4：写 BACKUP.md 的备份说明。** 使用下面的具体正文，并把 Task 2 的恢复命令纳入同一文档。

> 备份会短暂停止 web；不要对正在使用的生产实例进行未经安排的演练。仅支持默认本地附件目录 data。关闭直连数据库写入与其他会修改附件的进程后运行备份。将 .env 中的认证配置和其它部署配置单独保存到受保护的位置，不上传到 Git 或公共问题单。备份包含业务数据、用户与认证表，应放在访问受控的目录；脚本的 SHA-256 检查用于发现损坏，不提供加密或来源认证。
>
> 用 `bash scripts/backup-instance.sh "$PWD" /private/tmp/markpocket-backup-20261009` 创建新目录。目标目录已存在时改用新的名称，不覆盖。没有 COMPLETE 的目录视为失败产物，不能用于恢复。检查 web 已恢复运行；脚本报恢复启动失败时执行当前实例的 `docker compose start web`，检查健康状态。
>
> CSV 不包含附件二进制、权限和历史，不可替代本流程。恢复必须使用相同代码/镜像版本，验证通过后才按 UPGRADE.md 升级。只有数据库与附件同时回退才是完整回滚。

- [ ] **Step 5：提交脚本与初始手册。**

```bash
git add scripts/backup-instance.sh docs/BACKUP.md
git commit -m "feat: add quiesced instance backups"
```

## Task 2：隔离恢复演练与发布证据

**Files:** 修改 `docs/BACKUP.md`、`docs/README.md`、`README.md`、`README.zh.md`、`docs/UPGRADE.md`；新建 `docs/release/2026-10-09-recovery-evidence.md`。

**Interfaces:**
- Consumes: Task 1 备份目录；本地构建的 `markpocket:recovery-test`；只在这次演练的空数据库恢复。
- Produces: 包含实际代码 SHA、镜像 ID、执行时间、命令结果、文件校验与失败结果的记录。

- [ ] **Step 1：准备一次性源实例。** 以下命令在仓库根目录执行。创建新的临时目录并写独立 Compose；没有 `container_name`，没有复用原 data 或数据库卷；不使用仓库根 `.env`。

```bash
MARKPOCKET_SOURCE_COMMIT=$(git rev-parse HEAD)
export MARKPOCKET_SOURCE_COMMIT
docker build -t markpocket:recovery-test .
MARKPOCKET_DRILL=$(mktemp -d /private/tmp/markpocket-drill.XXXXXX)
mkdir "$MARKPOCKET_DRILL/source" "$MARKPOCKET_DRILL/restore"
cp package.json "$MARKPOCKET_DRILL/source/package.json"
cat > "$MARKPOCKET_DRILL/source/docker-compose.yml" <<'YAML'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: markpocket
      POSTGRES_PASSWORD: recovery-test-only
      POSTGRES_DB: markpocket
    volumes:
      - pg:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U markpocket -d markpocket']
      interval: 2s
      timeout: 2s
      retries: 30
  web:
    image: markpocket:recovery-test
    env_file: .env
    environment:
      DATABASE_URL: postgresql://markpocket:recovery-test-only@postgres:5432/markpocket
      BETTER_AUTH_URL: http://localhost:3300
      NODE_ENV: production
      PORT: 3000
      UPLOAD_DIR: /app/data/uploads
    ports:
      - '127.0.0.1:3300:3000'
    volumes:
      - ./data:/app/data
    depends_on:
      postgres:
        condition: service_healthy
volumes:
  pg:
YAML
node -e 'console.log("BETTER_AUTH_SECRET="+require("node:crypto").randomBytes(32).toString("hex"))' > "$MARKPOCKET_DRILL/source/.env"
chmod 600 "$MARKPOCKET_DRILL/source/.env"
docker compose -p mp-drill-source -f "$MARKPOCKET_DRILL/source/docker-compose.yml" up -d
```

- [ ] **Step 2：创建有意义的 fixture。** 打开 `http://localhost:3300`，注册 owner 和 viewer；owner 新建 Base 与一个有 text/number/attachment 字段的表，新增两条记录，先填 `before` 再改 `after` 产生 cell history。通过 UI 邀请 viewer，确认其只能读。在附件字段上传以下文件：

```bash
printf 'markpocket recovery attachment\n' > "$MARKPOCKET_DRILL/attachment.txt"
shasum -a 256 "$MARKPOCKET_DRILL/attachment.txt"
```

保存附件 SHA 与 Base 名称到证据文件，不记录密码、token 或实际业务数据。

- [ ] **Step 3：保存基线计数并备份。** 用独立 Compose project 环境调用脚本，确保它选中源演练实例。

```bash
docker compose -p mp-drill-source -f "$MARKPOCKET_DRILL/source/docker-compose.yml" exec -T postgres \
  psql -U markpocket -d markpocket -Atc \
  'SELECT (SELECT count(*) FROM "table"), (SELECT count(*) FROM record), (SELECT count(*) FROM cell), (SELECT count(*) FROM cell_history), (SELECT count(*) FROM attachment), (SELECT count(*) FROM base_member)' \
  > "$MARKPOCKET_DRILL/counts-before.txt"
COMPOSE_PROJECT_NAME=mp-drill-source bash scripts/backup-instance.sh \
  "$MARKPOCKET_DRILL/source" "$MARKPOCKET_DRILL/backup"
docker compose -p mp-drill-source -f "$MARKPOCKET_DRILL/source/docker-compose.yml" ps
```

预期 COMPLETE 存在、SHA 检查成功、源 web 恢复运行。然后停止源 web 释放 3300 端口，保持数据库与原 data 不变。

```bash
docker compose -p mp-drill-source -f "$MARKPOCKET_DRILL/source/docker-compose.yml" stop web
cp "$MARKPOCKET_DRILL/source/docker-compose.yml" "$MARKPOCKET_DRILL/restore/docker-compose.yml"
cp "$MARKPOCKET_DRILL/source/.env" "$MARKPOCKET_DRILL/restore/.env"
chmod 600 "$MARKPOCKET_DRILL/restore/.env"
```

- [ ] **Step 4：验证备份并恢复到独立空卷。** 校验失败立即停止；不要运行后续命令。下面命令必须逐项成功后继续。

```bash
test -f "$MARKPOCKET_DRILL/backup/COMPLETE"
(cd "$MARKPOCKET_DRILL/backup" && shasum -a 256 -c SHA256SUMS)
mkdir "$MARKPOCKET_DRILL/restore/data"
tar -xzf "$MARKPOCKET_DRILL/backup/data.tar.gz" -C "$MARKPOCKET_DRILL/restore/data"
docker compose -p mp-drill-restore -f "$MARKPOCKET_DRILL/restore/docker-compose.yml" up -d --wait postgres
docker compose -p mp-drill-restore -f "$MARKPOCKET_DRILL/restore/docker-compose.yml" exec -T postgres \
  pg_restore -U markpocket -d markpocket --no-owner --no-acl --exit-on-error \
  < "$MARKPOCKET_DRILL/backup/database.dump"
docker compose -p mp-drill-restore -f "$MARKPOCKET_DRILL/restore/docker-compose.yml" up -d web
```

只解压自己生成且已校验的归档。此处没有 `--clean`，恢复目标必须为空；已有表时报错，创建新的隔离目标再重试，不能删除旧实例来“修复”。

- [ ] **Step 5：执行恢复验收。** 运行相同 SQL 对比计数，登录两个原账号验证行为；下载附件到临时目录后核对 SHA。检查历史中 `before → after`，viewer 无写按钮且服务端写入被拒绝；owner 新增第三条记录并刷新确认持久化。

```bash
docker compose -p mp-drill-restore -f "$MARKPOCKET_DRILL/restore/docker-compose.yml" exec -T postgres \
  psql -U markpocket -d markpocket -Atc \
  'SELECT (SELECT count(*) FROM "table"), (SELECT count(*) FROM record), (SELECT count(*) FROM cell), (SELECT count(*) FROM cell_history), (SELECT count(*) FROM attachment), (SELECT count(*) FROM base_member)' \
  > "$MARKPOCKET_DRILL/counts-after.txt"
diff -u "$MARKPOCKET_DRILL/counts-before.txt" "$MARKPOCKET_DRILL/counts-after.txt"
curl --fail http://localhost:3300/api/health
```

计数对比必须在新增第三条记录之前执行。UI 操作使用现有 `tests/e2e/browser/05-export-history.yaml` 和 `06-role-gating.yaml` 的交互约定，端口替换为 3300。必须实际验证，不能仅引用场景文件作为通过证据。

- [ ] **Step 6：验证失败路径。** 源 web 当前停止：再执行一次备份，确认仍停止。复制备份到一个新临时目录，修改复制件中的 `data.tar.gz` 一个字节，运行 `shasum -c` 必须失败，不进行恢复。用下列 PATH 包装器模拟 Docker 在 pg_dump 时失败，其他命令转发给真实 Docker，确认脚本无 COMPLETE 且源 web 恢复运行。

```bash
mkdir "$MARKPOCKET_DRILL/bin"
command -v docker > "$MARKPOCKET_DRILL/docker-path"
cat > "$MARKPOCKET_DRILL/bin/docker" <<'SH'
#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = pg_dump ]; then exit 42; fi
done
exec "$(cat "$MARKPOCKET_DRILL/docker-path")" "$@"
SH
chmod +x "$MARKPOCKET_DRILL/bin/docker"
# 恢复实例 web 已验证完成后先停止，释放 3300。
docker compose -p mp-drill-restore -f "$MARKPOCKET_DRILL/restore/docker-compose.yml" stop web
docker compose -p mp-drill-source -f "$MARKPOCKET_DRILL/source/docker-compose.yml" start web
export MARKPOCKET_DRILL
PATH="$MARKPOCKET_DRILL/bin:$PATH" COMPOSE_PROJECT_NAME=mp-drill-source \
  bash scripts/backup-instance.sh "$MARKPOCKET_DRILL/source" "$MARKPOCKET_DRILL/failed-backup"
```

最后一条预期 exit 42；单独确认 `test ! -f "$MARKPOCKET_DRILL/failed-backup/COMPLETE"` 与源 `docker compose ps`。此项只是错误恢复注入测试，不替代 Step 4 的真实 pg_restore。

- [ ] **Step 7：记录发布候选证据并补文档链接。** 证据文件写入下列字段的实际值：代码 SHA、镜像 ID、源/目标 project 名、备份时间、SHA 检查结果、六项 SQL 计数、附件 SHA、owner/viewer/历史/新写入验证结果、失败备份状态恢复、CSV 子项目验收结果。未执行项写“未执行”及具体阻碍，不提前填通过。README 两种语言各新增 BACKUP.md 链接；UPGRADE 要求先备份、隔离演练再升级；docs/README 将 BACKUP.md 纳入现行文档。
- [ ] **Step 8：运行检查并保存证据。** 在专用测试实例运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `BASE_URL=http://localhost:3300 pnpm test:e2e-api`。API e2e 会写入测试数据，因此在恢复计数验证完成后运行。执行前启动恢复 web 并停止源 web，避免端口冲突。不创建或推送 tag。
- [ ] **Step 9：停止演练实例、保留证据与卷。** 分别对 `mp-drill-source`、`mp-drill-restore` 使用对应 compose 文件执行 `stop`。不使用 `down -v`，不清除用户工作区。记录临时目录供后续按需清理。只提交脚本/文档，备份、密钥和 fixture 不进入 Git。

```bash
git add docs/BACKUP.md docs/README.md README.md README.zh.md docs/UPGRADE.md docs/release/2026-10-09-recovery-evidence.md
git commit -m "docs: verify isolated instance recovery before release"
```

## 自检覆盖

O1→Task 1/Task 2 Step 6；O2→Task 1；O3→Task 2 Step 1/4；O4→Task 2 Step 2/3/5；O5→Task 2 Step 7/8。本计划仅交付发布基础，不等同于全产品稳定版验收。
