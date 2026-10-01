# Plugin Development Guide

## Overview

markpocket has a plugin system with two server-side extension points (**storage** and **fieldTypes**) plus two plugin-facing integration surfaces: **tRPC server routers** (injected with a `CoreServerApi`) and **client UI slots** (registered in `apps/web/src/plugins.client.ts`). Plugins are statically assembled at build time via `plugins.config.ts`.

Extension points are added only when a real plugin needs them (the project's "no premature abstraction" rule). viewType / uiSlot / event / authProvider registries existed as unused skeletons and were removed — they return together with the first plugin that requires them.

## Quick Start

A plugin is declared via the `PluginDefinition` type:

```typescript
import { definePlugin } from '@markpocket/plugin-sdk';

export default definePlugin({
  name: '@markpocket/my-plugin',
  version: '0.1.0',
  // optional extension points — only include what you use
  storage: [],
  fieldTypes: [],
});
```

`definePlugin` is an identity function that provides type checking and autocompletion. The return value is a plain `PluginDefinition` object.

## Extension Points

Each extension point accepts an array of `Contribution<T>` objects, where `Contribution<T>` is `{ name: string; impl: T }`.

### 1. Storage (`storage`)

Contributes a `StorageProvider` for file uploads.

```typescript
interface StorageProvider {
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
```

Example: `packages/plugin-storage-local/src/index.ts` implements a local-filesystem provider.

### 2. Field Type (`fieldTypes`)

Contributes a `FieldTypeContribution` for server-side value semantics.

```typescript
interface FieldTypeContribution {
  type: string;
  optionsSchema: OptionsSchema;       // zod-like .parse(raw)
  defaultOptions: () => FieldOptions;
  normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell;
  meta: { label: string; description: string };
}
```

`NormalizedCell` is a discriminated union:

```typescript
type NormalizedCell =
  | { empty: true }
  | { value: CellValue }
  | { error: string };
```

## Registering a Plugin

All plugins are assembled in a single file: `apps/web/src/plugins.config.ts`.

```typescript
import myPlugin from '@markpocket/my-plugin';
import { coreServerApi } from '@/server/plugins/core-api';

// Static assembly point: add your plugin here
export const plugins: readonly PluginDefinition[] = [myPlugin];

// If your plugin provides a tRPC router, merge it here
export const pluginRouters = {
  myPlugin: myPluginRouter(coreServerApi),
} as const;
```

The `loader.ts` iterates `plugins` and registers each `Contribution` into the corresponding registry. This runs once at process startup when `server/plugins/index.ts` is imported.

## Field Type Plugin Example

This example creates a custom "Rating" field type that stores a number from 1 to 5.

```typescript
// packages/plugin-rating/src/index.ts
import { definePlugin, type FieldTypeContribution } from '@markpocket/plugin-sdk';

const ratingField: FieldTypeContribution = {
  type: 'rating',
  optionsSchema: {
    parse(raw: unknown) {
      if (typeof raw !== 'object' || raw === null) return {};
      return raw as Record<string, unknown>;
    },
  },
  defaultOptions: () => ({ max: 5 }),
  meta: { label: 'Rating', description: '1-5 star rating' },
  normalizeCellValue(options, raw) {
    if (raw == null || raw === '') return { empty: true };
    const n = typeof raw === 'number' ? raw : Number(raw);
    const max = (options.max as number) ?? 5;
    if (Number.isNaN(n) || n < 1 || n > max) {
      return { error: `Rating must be between 1 and ${max}` };
    }
    return { value: n };
  },
};

export default definePlugin({
  name: '@markpocket/plugin-rating',
  version: '0.1.0',
  fieldTypes: [{ name: 'rating', impl: ratingField }],
});
```

Then register it in `plugins.config.ts`:

```typescript
import ratingPlugin from '@markpocket/plugin-rating';

export const plugins: readonly PluginDefinition[] = [ratingPlugin];
```

## Server Router Injection

A plugin can provide a tRPC router by using the `ServerRouterFactory` pattern. This gives the plugin access to the `CoreServerApi` without importing internal app modules.

```typescript
import type { CoreServerApi, ServerRouterFactory } from '@markpocket/plugin-sdk';
import { protectedProcedure, router } from '@markpocket/plugin-sdk/trpc';
import { z } from 'zod';

const myRouter: ServerRouterFactory<ReturnType<typeof buildRouter>> = (core) => buildRouter(core);

function buildRouter(core: CoreServerApi) {
  const { db, schema, queries, fieldTypes } = core;
  return router({
    greet: protectedProcedure
      .input(z.object({ name: z.string() }))
      .query(async ({ input }) => {
        return { message: `Hello, ${input.name}!` };
      }),
  });
}

export default myRouter;
```

### CoreServerApi

The `CoreServerApi` object gives plugins access to:

| Property | Description |
|---|---|
| `db` | Drizzle ORM instance (typed as `DrizzleLike` to avoid SDK dependency on app schema) |
| `schema` | `{ record, cell, field, table }` table references for Drizzle queries |
| `queries` | `{ listRecordsPivoted }` — reusable query helpers |
| `fieldTypes` | `{ FieldType, formatNumberToString, parseStringToNumber }` — field type constants and utilities |
| `auth` | `{ assertTableRole(tableId, userId, minRole) }` — the same role gate the core routers use; **always call it before touching a table** so the plugin is not an authorization bypass |

### tRPC Utilities

Import from `@markpocket/plugin-sdk/trpc`:

```typescript
import { router, publicProcedure, protectedProcedure } from '@markpocket/plugin-sdk/trpc';
```

- `router` — tRPC router builder
- `publicProcedure` — no auth required
- `protectedProcedure` — requires a valid session; throws `UNAUTHORIZED` otherwise

### Merging Plugin Routers

In `plugins.config.ts`:

```typescript
import csvServer from '@markpocket/plugin-csv/server';

export const pluginRouters = {
  csv: csvServer(coreServerApi),
} as const;
```

The app's main router merges these under their respective keys (e.g., `csv.import`, `csv.export`).

## UI Slot Plugin

A plugin can mount a React component into a named UI slot. Slots are registered client-side in `apps/web/src/plugins.client.ts` (there is deliberately no server-side UI-slot registry) and rendered with `<Slot id="…" ctx={…} />` from `@/lib/plugins/ui-slot-client`.

```typescript
// packages/plugin-my-ui/src/client.tsx
import type { ComponentType } from 'react';

type Ctx = {
  tables: Array<{ id: string; name: string }>;
  onAction: (tableId: string) => void;
};

const Component: ComponentType<{ ctx?: unknown }> = ({ ctx }) => {
  const c = ctx as Ctx;
  return (
    <div>
      {c.tables.map((t) => (
        <button key={t.id} onClick={() => c.onAction(t.id)}>
          {t.name}
        </button>
      ))}
    </div>
  );
};

export default { slotId: 'table-tools', Component };
```

The `ctx` prop is injected by the UI slot renderer with context specific to the slot. The `Component` is typed as `unknown` in the registry — it is cast to a React component type at the mounting site.

## Complete Example: CSV Plugin Walkthrough

The CSV plugin (`packages/plugin-csv/`) is the reference implementation. It demonstrates both a server router and a UI slot.

### Server Side (`src/server.ts`)

1. Creates a tRPC router via `ServerRouterFactory<ReturnType<typeof buildRouter>>`
2. Uses `core.db`, `core.schema`, `core.queries`, and `core.fieldTypes` for database access
3. Exposes two procedures:
   - `import` — accepts a `tableId` and `csvText`, parses CSV, inserts records and cells
   - `export` — accepts a `tableId`, returns CSV text using `listRecordsPivoted`
4. The `db` is cast to `any` because Drizzle's type-level chaining is too complex for the `DrizzleLike` interface

### Client Side (`src/client.tsx`)

1. Exports `{ slotId, Component }` — a `UiSlotContribution`
2. The `slotId` is `'table-tools'`, which renders in the table tools area of the UI
3. The `Component` receives `ctx` with `tables`, `onExport`, and `onImport` callbacks
4. Renders a download button and a file input for each table

### Assembly (`plugins.config.ts`)

```typescript
import csvServer from '@markpocket/plugin-csv/server';
import { coreServerApi } from '@/server/plugins/core-api';

export const pluginRouters = {
  csv: csvServer(coreServerApi),
} as const;
```

The CSV plugin does not contribute to `PluginDefinition.storage` or `PluginDefinition.fieldTypes` — it only provides a tRPC router and a UI slot. The UI slot is registered separately by the UI slot loader.

## Testing a Plugin

### Unit Tests

Co-locate test files with source code, following project conventions:

```typescript
// packages/plugin-my-plugin/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { myPlugin } from './index';

describe('myPlugin', () => {
  it('should define the plugin', () => {
    expect(myPlugin.name).toBe('@markpocket/my-plugin');
    expect(myPlugin.version).toBe('0.1.0');
  });
});
```

Run tests with:

```bash
pnpm test
```

### Type-Level Tests

Use `*.test-d.ts` files for compile-time type checks (via vitest typecheck):

```typescript
// packages/plugin-sdk/src/core-api.test-d.ts
import { expectTypeOf, test } from 'vitest';
import type { CoreServerApi } from './index';

test('CoreServerApi structure', () => {
  expectTypeOf<CoreServerApi>().toHaveProperty('db');
  expectTypeOf<CoreServerApi>().toHaveProperty('schema');
  expectTypeOf<CoreServerApi>().toHaveProperty('queries');
  expectTypeOf<CoreServerApi>().toHaveProperty('fieldTypes');
});
```

### Field Type Parity Tests

When contributing a field type, write parity tests covering empty, value, and error paths:

```typescript
import { describe, it, expect } from 'vitest';
import { ratingField } from './index';

describe('rating field type', () => {
  const opts = ratingField.defaultOptions();

  it('returns empty for null', () => {
    expect(ratingField.normalizeCellValue(opts, null)).toEqual({ empty: true });
  });

  it('accepts valid rating', () => {
    expect(ratingField.normalizeCellValue(opts, 4)).toEqual({ value: 4 });
  });

  it('rejects out-of-range', () => {
    expect(ratingField.normalizeCellValue(opts, 6)).toHaveProperty('error');
  });
});
```