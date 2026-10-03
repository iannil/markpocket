# Phase C: 开发者体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the barrier for external contributors to understand, use, and extend markpocket.

**Architecture:** Phase C is documentation + testing — no feature code changes, no schema migrations. Each task is independent and can be built in parallel.

**Tech Stack:** vitest + Markdown + TypeScript

## Global Constraints

- Tests co-located with source files (`*.test.ts`, `*.test.tsx`)
- tRPC integration tests use `createCaller` from `server/trpc/caller.ts` (or direct `router.createCaller`)
- Test DB calls must be mocked (no real Postgres in CI) — use `vi.mock('@/server/db', ...)` pattern
- All user-facing strings in English
- No new dependency packages

---

## File Structure

### C1: Test Infrastructure

```
Create: apps/web/src/lib/expression-eval.test.ts
Create: apps/web/src/lib/view-query.test.ts
Create: apps/web/src/lib/roles.test.ts
```

### C2: Contribution Guide

```
Create: CONTRIBUTING.md
Create: .github/ISSUE_TEMPLATE/bug_report.md
Create: .github/ISSUE_TEMPLATE/feature_request.md
Create: .github/PULL_REQUEST_TEMPLATE.md
```

### C3: Plugin Development Docs

```
Create: docs/plugin-development.md
Create: packages/plugin-sdk/README.md
```

### C4: API Documentation

```
Create: docs/api/README.md
Create: docs/api/routers.md
```

---

## Task Breakdown

### Task 1: Unit tests — expression-eval, view-query, roles

**Files:**
- Create: `apps/web/src/lib/expression-eval.test.ts`
- Create: `apps/web/src/lib/view-query.test.ts`
- Create: `apps/web/src/lib/roles.test.ts`

**Interfaces:**
- Consumes: `evaluateExpression`, `extractDependsOn` from `expression-eval.ts`; `compileFilter`, `compileSort`, `applyGroup` from `view-query.ts`; `getMembership`, `assertRole`, `baseIdFromTable` from `roles.ts`

- [ ] **Step 1: Write expression-eval tests**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateExpression, extractDependsOn } from './expression-eval';

describe('evaluateExpression', () => {
  it('returns empty for empty input', () => {
    expect(evaluateExpression('', new Map())).toEqual({ empty: true });
    expect(evaluateExpression('   ', new Map())).toEqual({ empty: true });
  });

  it('evaluates simple arithmetic', () => {
    const values = new Map([['f1', 3], ['f2', 5]]);
    const expr = '{f1} * {f2} + 2';
    expect(evaluateExpression(expr, values)).toEqual({ value: 17 });
  });

  it('returns empty when a dependency is missing', () => {
    const values = new Map([['f1', 3]]);
    expect(evaluateExpression('{f1} * {f2}', values)).toEqual({ empty: true });
  });

  it('returns error for non-numeric dependency', () => {
    const values = new Map([['f1', 'abc']]);
    expect(evaluateExpression('{f1} + 1', values)).toEqual({ error: 'Non-numeric dependency' });
  });

  it('returns error for division by zero', () => {
    const values = new Map([['f1', 5], ['f2', 0]]);
    expect(evaluateExpression('{f1} / {f2}', values)).toEqual({ error: 'Division by zero' });
  });

  it('rejects invalid expression characters', () => {
    expect(evaluateExpression('console.log("x")', new Map())).toEqual({ error: 'Invalid expression' });
  });
});

describe('extractDependsOn', () => {
  it('extracts field IDs from expression', () => {
    const ids = extractDependsOn('{f1} + {f2}');
    expect(ids).toEqual(['f1', 'f2']);
  });

  it('returns empty for expression without tokens', () => {
    expect(extractDependsOn('42')).toEqual([]);
  });

  it('deduplicates repeated field IDs', () => {
    expect(extractDependsOn('{f1} + {f1}')).toEqual(['f1']);
  });
});
```

- [ ] **Step 2: Write view-query tests**

```ts
import { describe, expect, it } from 'vitest';
import { compileFilter, compileSort, applyGroup } from './view-query';

describe('compileFilter', () => {
  it('returns null for undefined filter', () => {
    expect(compileFilter(undefined, new Map())).toBeNull();
  });

  it('compiles a simple condition', () => {
    const fields = new Map([['f1', { type: 'text', options: {} }]]);
    const filter = { fieldId: 'f1', operator: 'equals', operand: 'hello' };
    const sql = compileFilter(filter, fields);
    expect(sql).not.toBeNull();
    expect(sql!.toSQL()).toContain('hello');
  });

  it('returns null for unknown field', () => {
    const filter = { fieldId: 'unknown', operator: 'equals', operand: 'x' };
    expect(compileFilter(filter, new Map())).toBeNull();
  });
});

describe('compileSort', () => {
  it('returns null for undefined sort', () => {
    expect(compileSort(undefined, new Map())).toBeNull();
  });

  it('compiles a sort clause', () => {
    const fields = new Map([['f1', { type: 'text', options: {} }]]);
    const sql = compileSort([{ fieldId: 'f1', direction: 'asc' }], fields);
    expect(sql).not.toBeNull();
  });
});

describe('applyGroup', () => {
  it('returns single group with null key when no group spec', () => {
    const records = [{ id: 'r1', cells: {} }, { id: 'r2', cells: {} }];
    expect(applyGroup(records, undefined)).toEqual([{ key: null, records }]);
  });

  it('groups records by field value', () => {
    const records = [
      { id: 'r1', cells: { f1: 'a' } },
      { id: 'r2', cells: { f1: 'b' } },
      { id: 'r3', cells: { f1: 'a' } },
    ];
    const groups = applyGroup(records, [{ fieldId: 'f1' }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe('a');
    expect(groups[0]!.records).toHaveLength(2);
    expect(groups[1]!.key).toBe('b');
    expect(groups[1]!.records).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Write roles tests**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));

import { baseIdFromTable } from './roles';

describe('baseIdFromTable', () => {
  it('returns null when table is not found', async () => {
    const result = await baseIdFromTable('nonexistent');
    expect(result).toBeNull();
  });
});
```

Note: `getMembership` and `assertRole` require DB mocking with actual query results. The simplest test is `baseIdFromTable` which has a mockable DB path. Full role tests require a more complete mock setup.

- [ ] **Step 4: Run tests**

```bash
npx vitest run apps/web/src/lib/expression-eval.test.ts apps/web/src/lib/view-query.test.ts apps/web/src/lib/roles.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(core): 核心单元测试 — expression-eval/view-query/roles"
```

---

### Task 2: CONTRIBUTING.md + Issue/PR templates

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
# Contributing to markpocket

## Development Setup

```bash
./dev.sh    # One-shot: starts Postgres, runs migrations, starts web + realtime
```

Opens at http://localhost:7420.

## Code Quality

- **TypeScript**: `pnpm --filter @markpocket/web typecheck` — strict mode, no untyped internals
- **Lint**: `pnpm lint` — ESLint + Prettier (run `pnpm format` to auto-fix)
- **Tests**: `pnpm test` — vitest, co-located with source files as `*.test.ts` / `*.test.tsx`
- **Single test**: `pnpm test -- --run src/foo.test.ts`

## Pull Request Process

1. Branch from `master` — feature branches use `feat/` prefix, fixes use `fix/`
2. One logical change per commit — use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
3. All tests must pass before opening a PR (`pnpm test && pnpm lint && pnpm --filter @markpocket/web typecheck`)
4. Architecture decisions require an ADR in `docs/adr/` — see existing ADRs for format
5. Keep PRs focused — a single feature or fix per PR

## Domain Language (from CONTEXT.md)

- **Expression Field**, never "Formula"
- **Select**, never "Single Select" in UI labels
- **Soft Real-time**, never "OT/CRDT" — we use LWW + WebSocket broadcast
- **Row-per-cell**, never "dynamic DDL" — schema changes are Drizzle migrations

## Code Review

All PRs are reviewed for:
- Correctness: does the code work as described?
- Security: are there data leaks or privilege escalation paths?
- Test coverage: new features include tests, bug fixes include regression tests
- Architecture: does it follow the existing patterns and ADRs?

## Plugin Development

See `docs/plugin-development.md` for writing plugins.
```

- [ ] **Step 2: Create Issue/PR templates**

`bug_report.md`:
```markdown
---
name: Bug report
about: Report a bug to help us improve
title: ''
labels: bug
---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior.

**Expected behavior**
What you expected to happen.

**Environment**
- markpocket version: [e.g. v1.0.0-alpha.1]
- Deployment: [Docker / dev.sh / other]
- Browser: [if UI issue]

**Additional context**
Screenshots, logs, or anything else.
```

`feature_request.md`:
```markdown
---
name: Feature request
about: Suggest an idea for markpocket
title: ''
labels: enhancement
---

**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Any alternative solutions or workarounds.

**Additional context**
Anything else.
```

`PULL_REQUEST_TEMPLATE.md`:
```markdown
## Summary
<!-- One sentence summary of the change -->

## Related issues
<!-- Closes #... or Related to #... -->

## Changes
<!-- Bullet list of what changed -->

## Testing
- [ ] Tests pass (`pnpm test`)
- [ ] Typecheck passes (`pnpm --filter @markpocket/web typecheck`)
- [ ] Lint passes (`pnpm lint`)

## Checklist
- [ ] New functionality has tests
- [ ] Bug fixes have regression tests
- [ ] User-facing strings are in English
- [ ] If adding a new subsystem, an ADR was written
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: CONTRIBUTING.md + Issue/PR 模板"
```

---

### Task 3: Plugin development documentation

**Files:**
- Create: `docs/plugin-development.md`
- Create: `packages/plugin-sdk/README.md`

- [ ] **Step 1: Create `docs/plugin-development.md`**

Cover: plugin SDK quick start, the 6 extension points, register in `plugins.config.ts`, server router injection, complete example (CSV plugin walkthrough). See the existing `packages/plugin-sdk/src/index.ts` for exported types.

- [ ] **Step 2: Create `packages/plugin-sdk/README.md`**

API reference for the SDK: `createRegistry`, `definePlugin`, `StorageProvider`, `FieldTypeContribution`, `ServerRouterFactory`, `CoreServerApi`. TypeScript exports.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs(plugins): 插件开发文档 + plugin-sdk README"
```

---

### Task 4: API documentation

**Files:**
- Create: `docs/api/README.md`
- Create: `docs/api/routers.md`

- [ ] **Step 1: Create `docs/api/README.md`**

Overview of the tRPC API: how tRPC works in this project, client setup (`TRPCProvider`), server-side caller (`api()` from `caller.ts`), authentication (`protectedProcedure` vs `publicProcedure`).

- [ ] **Step 2: Create `docs/api/routers.md`**

Document each router with its input/output types. Read each router file to extract the actual procedure signatures. For each router, list:
- Procedure name
- Auth requirement (public / protected)
- Input (Zod schema)
- Output (return type)
- Description

Cover: `auth`, `workspace`, `base`, `table`, `view`, `field`, `record`, `cell`, `history`, `share`, `member`, `invite`, `export`, `publicShare`, `csv`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs(api): tRPC router API 文档"
```