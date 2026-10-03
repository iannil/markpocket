# 插件基础设施（SDK + 加载器 + 注册表 + storage-local 归档）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「核心+插件」的基础设施——插件 SDK、编译期加载器、6 个扩展点注册表——并把已有的 `StorageProvider` 归档为第一个 workspace-package 插件 `@markpocket/plugin-storage-local`，端到端验证整条脊柱。

**Architecture:** 编译期捆绑。插件是 pnpm workspace 包，导出声明式 `PluginDefinition`；`apps/web/src/plugins.config.ts` 静态 import 它们；加载器在进程首次读注册表时同步跑一次，把各贡献填进对应注册表。所有注册表复刻同一 `createRegistry` 形状（register/get/list + 未知名字/重名报错）。本计划只做 storage 一个真实扩展点；其余 5 个注册表建为骨架，供后续计划填充。

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), pnpm workspace, Turborepo, Vitest（本计划新增测试基座）, Next.js 16, tRPC 11, Drizzle。

## Global Constraints

- Node `>=22`；ESM（所有包 `"type": "module"`）。
- 包不经构建步骤：`package.json` 的 `main`/`types` 直指 `src/index.ts`，由 bundler（Next/rspack/vitest）读 TS 源。
- 第一方插件放 `packages/plugin-*`，包名 `@markpocket/plugin-*`，`version: "0.0.0"`，`private: true`。
- 测试文件用相对导入或 workspace 包名导入，**不使用 `@/` 别名**（vitest 未配 alias）。
- 不改动 ADR-0001~0005：数据模型、row-per-cell 写路径、值语义、一致性契约保持不变。
- 单引号、2 空格缩进、prettier + eslint（pre-commit 已配 lint-staged，提交时自动跑）。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: 测试基座 + `@markpocket/plugin-sdk`（createRegistry + 类型）

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`（根，加 vitest devDep + test 脚本）
- Create: `vitest.config.ts`（根）
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/src/index.ts`
- Create: `packages/plugin-sdk/src/registry.ts`
- Test: `packages/plugin-sdk/src/registry.test.ts`

**Interfaces:**
- Produces:
  - `createRegistry<T>(kind: string): Registry<T>`，`Registry<T> = { register(name: string, value: T): void; get(name: string): T; tryGet(name: string): T | undefined; list(): Array<{ name: string; value: T }> }`
  - `interface StorageProvider { makeKey(filename: string): string; put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }`
  - `interface Contribution<T> { name: string; impl: T }`
  - `interface PluginDefinition { name: string; version: string; storage?: Contribution<StorageProvider>[]; fieldTypes?: Contribution<unknown>[]; viewTypes?: Contribution<unknown>[]; uiSlots?: Contribution<unknown>[]; events?: Contribution<unknown>[]; authProviders?: Contribution<unknown>[] }`
  - `definePlugin(def: PluginDefinition): PluginDefinition`

- [ ] **Step 1: 加 `packages/*` 到 workspace**

改 `pnpm-workspace.yaml` 为：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: 根 `package.json` 加 vitest 与 test 脚本**

在 `scripts` 加一行 `"test": "vitest run"`；在 `devDependencies` 加 `"vitest": "^3.2.4"`。

- [ ] **Step 3: 建根 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: 建 SDK 包 `packages/plugin-sdk/package.json`**

```json
{
  "name": "@markpocket/plugin-sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "devDependencies": {
    "@types/node": "^26.0.1"
  }
}
```

- [ ] **Step 5: 安装以链接 workspace 包**

Run: `pnpm install`
Expected: 无错误；`packages/plugin-sdk` 出现在 workspace。

- [ ] **Step 6: 写失败测试 `packages/plugin-sdk/src/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { createRegistry } from './registry';

describe('createRegistry', () => {
  it('registers and gets by name', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(r.get('a')).toBe(1);
  });

  it('throws on unknown name, listing registered names', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(() => r.get('b')).toThrow(/Unknown thing "b".*Registered: a/);
  });

  it('throws on duplicate registration', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    expect(() => r.register('a', 2)).toThrow(/Duplicate thing "a"/);
  });

  it('tryGet returns undefined instead of throwing', () => {
    const r = createRegistry<number>('thing');
    expect(r.tryGet('x')).toBeUndefined();
  });

  it('list returns all entries', () => {
    const r = createRegistry<number>('thing');
    r.register('a', 1);
    r.register('b', 2);
    expect(r.list()).toEqual([
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ]);
  });
});
```

- [ ] **Step 7: 跑测试确认失败**

Run: `pnpm test -- registry`
Expected: FAIL —— `Cannot find module './registry'`。

- [ ] **Step 8: 实现 `packages/plugin-sdk/src/registry.ts`**

```ts
export interface Registry<T> {
  register(name: string, value: T): void;
  get(name: string): T;
  tryGet(name: string): T | undefined;
  list(): Array<{ name: string; value: T }>;
}

export function createRegistry<T>(kind: string): Registry<T> {
  const map = new Map<string, T>();
  return {
    register(name, value) {
      if (map.has(name)) throw new Error(`Duplicate ${kind} "${name}"`);
      map.set(name, value);
    },
    get(name) {
      const value = map.get(name);
      if (value === undefined) {
        const known = [...map.keys()].join(', ') || '(none registered)';
        throw new Error(`Unknown ${kind} "${name}". Registered: ${known}`);
      }
      return value;
    },
    tryGet(name) {
      return map.get(name);
    },
    list() {
      return [...map.entries()].map(([name, value]) => ({ name, value }));
    },
  };
}
```

- [ ] **Step 9: 写 SDK barrel `packages/plugin-sdk/src/index.ts`（含类型与 definePlugin）**

```ts
export { createRegistry, type Registry } from './registry';

// 一个存储后端的能力面（ADR-0006）。核心只依赖此接口。
export interface StorageProvider {
  /** 为新上传生成存储 key，保留扩展名。 */
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// 具名贡献：{ name, impl }。加载器按 name 注册进对应注册表。
export interface Contribution<T> {
  name: string;
  impl: T;
}

// 插件的声明式清单。缺省字段即不贡献该类扩展点。
// 本计划只有 storage 是真实类型；其余为后续计划收紧的占位。
export interface PluginDefinition {
  name: string;
  version: string;
  storage?: Contribution<StorageProvider>[];
  fieldTypes?: Contribution<unknown>[];
  viewTypes?: Contribution<unknown>[];
  uiSlots?: Contribution<unknown>[];
  events?: Contribution<unknown>[];
  authProviders?: Contribution<unknown>[];
}

// 身份函数：给插件作者类型检查与自动补全。
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}
```

- [ ] **Step 10: 跑测试确认通过**

Run: `pnpm test -- registry`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 11: 提交**

```bash
git add pnpm-workspace.yaml package.json vitest.config.ts packages/plugin-sdk pnpm-lock.yaml
git commit -m "feat(sdk): 插件 SDK 基座 —— createRegistry + PluginDefinition + vitest

落地 workspace packages/* + vitest 测试基座；@markpocket/plugin-sdk 导出
通用注册表工厂（register/get/list + 未知/重名报错）、StorageProvider 接口、
PluginDefinition 声明式清单与 definePlugin 身份函数。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 注册表实例 + 加载器（apps/web）

**Files:**
- Create: `apps/web/src/server/plugins/registry.ts`
- Create: `apps/web/src/server/plugins/loader.ts`
- Test: `apps/web/src/server/plugins/loader.test.ts`
- Modify: `apps/web/package.json`（加 SDK 依赖）

**Interfaces:**
- Consumes: `PluginDefinition`, `Contribution`, `StorageProvider`, `createRegistry`, `Registry`（Task 1）
- Produces:
  - `registry.ts`：`storageRegistry: Registry<StorageProvider>`、`fieldTypeRegistry`、`viewTypeRegistry`、`uiSlotRegistry`、`eventRegistry`、`authProviderRegistry`（后 5 个为 `Registry<unknown>`）
  - `loader.ts`：`loadPlugins(plugins: readonly PluginDefinition[]): void`

- [ ] **Step 1: apps/web 加 SDK 依赖**

在 `apps/web/package.json` 的 `dependencies` 加 `"@markpocket/plugin-sdk": "workspace:*"`，然后：

Run: `pnpm install`
Expected: `@markpocket/plugin-sdk` 链接进 `apps/web/node_modules`。

- [ ] **Step 2: 建注册表实例 `apps/web/src/server/plugins/registry.ts`**

```ts
import { createRegistry, type Registry, type StorageProvider } from '@markpocket/plugin-sdk';

// 6 个扩展点注册表，全部同形（createRegistry）。本计划只有 storage 有真实贡献；
// 其余为骨架，供 Field Type / View / UI Slot / Event / Auth 各自计划填充。
export const storageRegistry: Registry<StorageProvider> = createRegistry('storage provider');
export const fieldTypeRegistry: Registry<unknown> = createRegistry('field type');
export const viewTypeRegistry: Registry<unknown> = createRegistry('view type');
export const uiSlotRegistry: Registry<unknown> = createRegistry('ui slot');
export const eventRegistry: Registry<unknown> = createRegistry('event handler');
export const authProviderRegistry: Registry<unknown> = createRegistry('auth provider');
```

- [ ] **Step 3: 写失败测试 `apps/web/src/server/plugins/loader.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { loadPlugins } from './loader';
import { storageRegistry } from './registry';

describe('loadPlugins', () => {
  it('registers each storage contribution into the storage registry', () => {
    const fake = {
      makeKey: () => 'k',
      put: async () => {},
      get: async () => Buffer.from(''),
      remove: async () => {},
    };
    loadPlugins([
      { name: 'p', version: '0', storage: [{ name: 'mem', impl: fake }] },
    ]);
    expect(storageRegistry.get('mem')).toBe(fake);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm test -- loader`
Expected: FAIL —— `Cannot find module './loader'`。

- [ ] **Step 5: 实现 `apps/web/src/server/plugins/loader.ts`**

```ts
import type { PluginDefinition } from '@markpocket/plugin-sdk';

import {
  authProviderRegistry,
  eventRegistry,
  fieldTypeRegistry,
  storageRegistry,
  uiSlotRegistry,
  viewTypeRegistry,
} from './registry';

// 编译期加载：遍历清单，把每类具名贡献填进对应注册表。
// 同步、幂等边界由调用方（server/plugins/index.ts 的单次 import）保证。
export function loadPlugins(plugins: readonly PluginDefinition[]): void {
  for (const plugin of plugins) {
    plugin.storage?.forEach((c) => storageRegistry.register(c.name, c.impl));
    plugin.fieldTypes?.forEach((c) => fieldTypeRegistry.register(c.name, c.impl));
    plugin.viewTypes?.forEach((c) => viewTypeRegistry.register(c.name, c.impl));
    plugin.uiSlots?.forEach((c) => uiSlotRegistry.register(c.name, c.impl));
    plugin.events?.forEach((c) => eventRegistry.register(c.name, c.impl));
    plugin.authProviders?.forEach((c) => authProviderRegistry.register(c.name, c.impl));
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test -- loader`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/server/plugins apps/web/package.json pnpm-lock.yaml
git commit -m "feat(plugins): 6 个扩展点注册表 + 编译期加载器

registry.ts 用 createRegistry 建 storage/field-type/view-type/ui-slot/
event/auth-provider 六个同形注册表（后五者本期为骨架）；loader 遍历
PluginDefinition 清单把各具名贡献填进对应注册表。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `@markpocket/plugin-storage-local` 包

**Files:**
- Create: `packages/plugin-storage-local/package.json`
- Create: `packages/plugin-storage-local/src/index.ts`
- Test: `packages/plugin-storage-local/src/index.test.ts`

**Interfaces:**
- Consumes: `definePlugin`, `StorageProvider`, `PluginDefinition`（Task 1）
- Produces: default export `PluginDefinition`，含 `storage: [{ name: 'local', impl: localProvider }]`；具名导出 `localProvider: StorageProvider`

- [ ] **Step 1: 建包 `packages/plugin-storage-local/package.json`**

```json
{
  "name": "@markpocket/plugin-storage-local",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@markpocket/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^26.0.1"
  }
}
```

- [ ] **Step 2: 安装链接**

Run: `pnpm install`
Expected: 无错误。

- [ ] **Step 3: 写失败测试 `packages/plugin-storage-local/src/index.test.ts`**

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mp-storage-'));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('plugin-storage-local', () => {
  it('exposes a local storage contribution', async () => {
    const plugin = (await import('./index')).default;
    expect(plugin.storage?.[0]?.name).toBe('local');
  });

  it('round-trips put/get/remove', async () => {
    const { localProvider } = await import('./index');
    const key = localProvider.makeKey('note.txt');
    await localProvider.put(key, Buffer.from('hi'));
    expect((await localProvider.get(key)).toString()).toBe('hi');
    await localProvider.remove(key);
    await expect(localProvider.get(key)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm test -- storage-local`
Expected: FAIL —— `Cannot find module './index'`。

- [ ] **Step 5: 实现 `packages/plugin-storage-local/src/index.ts`**

（逻辑逐字搬自现有 `apps/web/src/server/storage/local.ts`，包成 StorageProvider 对象 + PluginDefinition。）

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { definePlugin, type StorageProvider } from '@markpocket/plugin-sdk';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

async function ensureDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export const localProvider: StorageProvider = {
  makeKey(filename) {
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    return `${randomUUID()}${ext}`;
  },
  async put(key, data) {
    await ensureDir();
    await writeFile(join(UPLOAD_DIR, key), data);
  },
  async get(key) {
    return readFile(join(UPLOAD_DIR, key));
  },
  async remove(key) {
    try {
      await unlink(join(UPLOAD_DIR, key));
    } catch {
      // ignore if already gone
    }
  },
};

export default definePlugin({
  name: '@markpocket/plugin-storage-local',
  version: '0.0.0',
  storage: [{ name: 'local', impl: localProvider }],
});
```

> 注：`UPLOAD_DIR` 在模块加载时读一次 env。测试在 `beforeAll` 里先设 `process.env.UPLOAD_DIR` 再动态 `import('./index')`，故顺序正确。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test -- storage-local`
Expected: PASS（2 个用例）。

- [ ] **Step 7: 提交**

```bash
git add packages/plugin-storage-local pnpm-lock.yaml
git commit -m "feat(plugin-storage-local): 本地磁盘存储归档为第一方插件包

把 server/storage/local.ts 逐字迁成 workspace 包，导出 PluginDefinition
（storage: local）与 localProvider，dogfood「插件即 npm 包」分发模型。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 装配加载器进 apps/web + 改接调用点 + 删旧 storage

**Files:**
- Create: `apps/web/src/plugins.config.ts`
- Create: `apps/web/src/server/plugins/index.ts`
- Create: `apps/web/src/server/plugins/storage.ts`
- Modify: `apps/web/package.json`（加 plugin-storage-local 依赖）
- Modify: `apps/web/src/app/api/upload/route.ts`
- Modify: `apps/web/src/app/api/files/[id]/route.ts`
- Delete: `apps/web/src/server/storage/local.ts`
- Delete: `apps/web/src/server/storage/provider.ts`
- Delete: `apps/web/src/server/storage/index.ts`

**Interfaces:**
- Consumes: `loadPlugins`（Task 2）、`storageRegistry`（Task 2）、`@markpocket/plugin-storage-local` default export（Task 3）、`StorageProvider`（Task 1）
- Produces: `plugins.config.ts` 具名导出 `plugins: readonly PluginDefinition[]`；`server/plugins/index.ts` 具名导出 `getStorage(): StorageProvider`（并 re-export registry.ts）

- [ ] **Step 1: apps/web 加 storage-local 依赖**

在 `apps/web/package.json` 的 `dependencies` 加 `"@markpocket/plugin-storage-local": "workspace:*"`，然后 `pnpm install`。

- [ ] **Step 2: 建静态组装点 `apps/web/src/plugins.config.ts`**

```ts
import storageLocal from '@markpocket/plugin-storage-local';
import type { PluginDefinition } from '@markpocket/plugin-sdk';

// 唯一的静态组装点：装插件 = 在此加一行 + docker build。
// 声明了 tRPC router 的插件（后续计划）还需在此处的 pluginRouters 静态合并。
export const plugins: readonly PluginDefinition[] = [storageLocal];
```

- [ ] **Step 3: 建 storage 解析器 `apps/web/src/server/plugins/storage.ts`**

```ts
import type { StorageProvider } from '@markpocket/plugin-sdk';

import { storageRegistry } from './registry';

// 按 STORAGE_PROVIDER 解析活动后端，缺省 'local'。
export function getStorage(): StorageProvider {
  return storageRegistry.get(process.env.STORAGE_PROVIDER ?? 'local');
}
```

- [ ] **Step 4: 建引导 barrel `apps/web/src/server/plugins/index.ts`**

```ts
import { loadPlugins } from './loader';
import { plugins } from '@/plugins.config';

// 进程首次 import 本模块时同步跑一次加载器 —— 所有注册表消费者都经此 barrel，
// 故读注册表前必已填充。等价于旧 storage barrel 的副作用 import 纪律，但集中化。
loadPlugins(plugins);

export { getStorage } from './storage';
export * from './registry';
```

- [ ] **Step 5: 改接 `upload/route.ts`**

把第 5 行 `import { getStorage } from '@/server/storage';` 改为 `import { getStorage } from '@/server/plugins';`。其余不变（`getStorage().makeKey/put` 调用点已在 ADR-0006 就位）。

- [ ] **Step 6: 改接 `files/[id]/route.ts`**

把 `import { getStorage } from '@/server/storage';` 改为 `import { getStorage } from '@/server/plugins';`。

- [ ] **Step 7: 删旧 storage 目录**

```bash
git rm apps/web/src/server/storage/local.ts apps/web/src/server/storage/provider.ts apps/web/src/server/storage/index.ts
```

- [ ] **Step 8: 确认无残留引用 + 类型通过**

Run: `grep -rn "server/storage" apps/web/src` —— Expected: 无输出。
Run: `pnpm --filter @markpocket/web typecheck`
Expected: 退出码 0，无类型错误。

- [ ] **Step 9: 回归 —— 附件上传/下载真跑一遍**

启动 dev（`pnpm --filter @markpocket/web dev` + Postgres），在 UI 里对某 attachment 字段上传一个文件、刷新后下载，确认字节一致。
Expected: 上传返回 `{id, filename}`，下载内容与原文件一致（等价于加载器已驱动 `local` provider 注册）。

- [ ] **Step 10: 提交**

```bash
git add apps/web
git commit -m "refactor(plugins): 加载器驱动 storage 注册，删除 in-app storage 模块

plugins.config.ts 静态组装 + server/plugins barrel 首次 import 跑加载器；
getStorage 迁至 server/plugins；upload/files 调用点改接；删除 server/storage/*。
storage 注册路径从副作用 import 收敛为加载器单一路径。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ADR-0007 记录加载器与注册表

**Files:**
- Create: `docs/adr/0007-plugin-loader-and-registries.md`

**Interfaces:** 无代码接口；文档。

- [ ] **Step 1: 写 ADR-0007**

按仓库 ADR 体例（状态/日期/相关、背景、决策、后果、备选方案、反悔代价），记录：编译期捆绑、`plugins.config.ts` 静态组装点、`createRegistry` 同形注册表、加载器单次 import 幂等、storage 从 ADR-0006 的 in-app registry 迁为 workspace 包的演进。内容依据 `docs/superpowers/specs/2026-07-09-plugin-architecture-design.md` §2/§3。

```markdown
# ADR-0007：插件加载器与扩展点注册表

- **状态**：Accepted
- **日期**：2026-07-09
- **相关**：落地 `2026-07-09-plugin-architecture-design.md` §2/§3；延续 ADR-0006（StorageProvider 接缝）

## 背景

ADR-0006 用「注册表 + 解析器」抽出了第一个扩展点，但注册表是 storage 专属、注册靠副作用 import，且实现在 apps/web 内。要支持多扩展点与「插件即 npm 包」，需要统一的加载与注册机制。

## 决策

1. **编译期捆绑**：插件是 workspace/npm 包，列在 `apps/web/src/plugins.config.ts`，build 时静态 import。装/卸插件 = 改配置 + rebuild。与 tRPC/Next.js 静态编译零摩擦（见备选）。
2. **同形注册表**：所有扩展点用 `createRegistry<T>(kind)`（register/get/list + 未知/重名报错）。storage 复用此形，另建 field-type/view-type/ui-slot/event/auth-provider 五个骨架。
3. **声明式清单 + 单一加载路径**：插件导出 `PluginDefinition`；`loadPlugins` 遍历填充注册表；`server/plugins` barrel 首次 import 时同步跑一次，消费者经 barrel 读注册表，保证读前已填充。
4. **只有 tRPC server 路由需静态类型**，故仅它需在 `plugins.config.ts` 静态合并；其余扩展点运行时查表，不侵蚀 client 类型。

## 后果

**正面**：多扩展点统一机制；storage 成为首个 workspace 包插件，dogfood 分发模型；client tRPC 类型零妥协。
**负面**：装插件需 rebuild（非运行时热插）；`plugins.config.ts` 手工维护；注册表是进程内单例，依赖 barrel 的 import 纪律。

## 备选方案

- **运行时动态加载**：契合「像装 App」，但与 Next RSC/打包、tRPC 编译期类型强冲突，需类型双轨 + 沙箱，核心膨胀。否决（留后续 spec）。
- **副作用 import 注册（ADR-0006 现状）**：简单但无清单、难反省、注册顺序隐式。否决——改声明式清单。

## 反悔代价

低。加载器与注册表是新增的加法层；storage 回退＝改回直接 import。运行时动态加载若将来必须，属新增能力而非推翻本决策。
```

- [ ] **Step 2: 提交**

```bash
git add docs/adr/0007-plugin-loader-and-registries.md
git commit -m "docs(adr): ADR-0007 插件加载器与扩展点注册表

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 后续计划（不在本计划内）

- **Plan 2 — CSV 插件 + 核心服务注入上下文**：CSV 现耦合 `@/server/db`/`field-types`/`db-queries`；需设计 `CoreServerApi` 注入（db + procedure builder + queries）让 `packages/*` 插件不 import `@/`。落地 Server Router + UI Slot + Event 三扩展点，加 router-declared ⊆ pluginRouters 启动校验。
- **Plan 3 — Field Type 注册表**：`field-types.ts` 静态字典 → 注册表，10 内建类型迁进 `plugin-builtin-fields`（逐类型迁移 + 回归，ADR-0005 值语义强制点留核心）。含 client 侧 renderer 注册表与 client bootstrap 装配。
- **Plan 4 — View Type 注册表**：Form 迁进 `plugin-view-form`。
- **Plan 5 — Auth Provider**：包装 better-auth social/OIDC 配置。

---

## Self-Review

**Spec coverage（对 spec 各节）**：
- §1 决策（编译期捆绑/数据内核/范围）→ 贯穿本计划与 ADR-0007。✅
- §2 核心边界 → 本计划只动 storage 归档；field/view/csv 边界迁移在 Plan 2–4。本计划范围内的 storage 部分 ✅。
- §3 加载模型（plugins.config 静态组装、createRegistry、单一加载路径、只有 router 需静态类型）→ Task 1–4 + ADR-0007。✅
- §4 六扩展点接口 → storage 真实实现；其余 5 注册表骨架（Task 2）。接口细化在各后续计划。✅（骨架）
- §5 目录布局 → `packages/plugin-sdk`、`packages/plugin-storage-local`、`apps/web/src/server/plugins/*`、`plugins.config.ts` 全部落地。✅
- §6 抽出顺序 → 本计划 = 步骤 2 + storage 归档；步骤 3（CSV）起入后续计划。✅
- §7 测试策略 → 注册表单测（Task 1）、加载器单测（Task 2）、storage round-trip（Task 3）、附件回归 + typecheck（Task 4）。✅
- §8 风险（config 手工维护/单例 import 纪律/编译期非运行时）→ ADR-0007 后果与备选记录。router 校验风险明确推迟到 Plan 2。✅

**Placeholder scan**：无 TBD/TODO；每个代码步骤含完整代码；每个测试步骤含完整断言。✅

**Type consistency**：`StorageProvider`（SDK 定义）→ registry `Registry<StorageProvider>` → `getStorage(): StorageProvider` → `localProvider: StorageProvider`，一致。`PluginDefinition.storage: Contribution<StorageProvider>[]` → 加载器 `plugin.storage?.forEach((c) => storageRegistry.register(c.name, c.impl))` → `plugin-storage-local` 的 `storage: [{ name: 'local', impl: localProvider }]`，一致。`loadPlugins(plugins: readonly PluginDefinition[])` 与 `plugins.config.ts` 的 `plugins: readonly PluginDefinition[]`，一致。✅
