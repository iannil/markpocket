# @markpocket/plugin-sdk

TypeScript SDK for building markpocket plugins. Provides the extension-point types, the registry helper, and the declaration helper that all plugins use.

## Installation

This is a worktree-internal TypeScript package in the markpocket monorepo. It is consumed via workspace references, not published to npm:

```bash
# From the monorepo root (package.json already lists it as a workspace dep)
pnpm install
```

Plugins import from the package root and from the `/trpc` subpath:

```typescript
import { definePlugin, type PluginDefinition } from '@markpocket/plugin-sdk';
import { protectedProcedure, router, publicProcedure } from '@markpocket/plugin-sdk/trpc';
```

The SDK depends on `@trpc/server` (for the `/trpc` subpath) and `@types/node` (dev only).

## API Reference

### `createRegistry<T>(kind: string): Registry<T>`

Creates a string-keyed registry for a given contribution type. Used internally by markpocket's six extension-point registries; plugins rarely need it directly, but it is exported and unit-tested.

```typescript
interface Registry<T> {
  register(name: string, value: T): void;          // throws on duplicate
  get(name: string): T;                            // throws with a helpful message if unknown
  tryGet(name: string): T | undefined;
  list(): Array<{ name: string; value: T }>;
}
```

- `register` throws `Duplicate <kind> "<name>"` if the name is already taken.
- `get` throws `Unknown <kind> "<name>". Registered: ...` on miss, listing known names.
- `tryGet` returns `undefined` instead of throwing.

### `definePlugin(def: PluginDefinition): PluginDefinition`

Identity function that type-checks a plugin manifest and provides autocompletion. Runtime behavior is a plain object return — no side effects.

### `Contribution<T>`

```typescript
interface Contribution<T> {
  name: string;   // unique within its registry
  impl: T;
}
```

A named contribution is a `{ name, impl }` pair. The loader registers each contribution into the matching registry by `name`.

### `PluginDefinition`

```typescript
interface PluginDefinition {
  name: string;
  version: string;
  storage?: Contribution<StorageProvider>[];
  fieldTypes?: Contribution<unknown>[];      // loader narrows to FieldTypeContribution
  viewTypes?: Contribution<unknown>[];
  uiSlots?: Contribution<unknown>[];
  events?: Contribution<unknown>[];
  authProviders?: Contribution<unknown>[];
}
```

A plugin's declarative manifest. Omit the fields you do not contribute. `name` should be a package-style identifier (e.g. `@markpocket/plugin-storage-local`).

### `StorageProvider`

```typescript
interface StorageProvider {
  /** Generate a storage key for a new upload, preserving the extension. */
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
```

The capability surface for a storage backend (ADR-0006). The core depends only on this interface. See `packages/plugin-storage-local/src/index.ts` for a filesystem implementation.

### `FieldTypeContribution`

```typescript
type CellValue = string | number | boolean | string[];
type FieldOptions = Record<string, unknown>;
type NormalizedCell = { empty: true } | { value: CellValue } | { error: string };

interface OptionsSchema {
  parse(raw: unknown): FieldOptions;
}

interface FieldTypeContribution {
  type: string;
  optionsSchema: OptionsSchema;          // any zod-like .parse — SDK does not depend on zod
  defaultOptions: () => FieldOptions;
  normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell;
  meta: { label: string; description: string };
}
```

Server-side value semantics for a field type (ADR-0009). `normalizeCellValue` must return the discriminated union: `{ empty: true }` to delete the cell row, `{ value }` to store, or `{ error }` to reject the write.

### `CoreServerApi`

```typescript
interface CoreSchema {
  record: unknown;
  cell: unknown;
  field: unknown;
  table: unknown;
}

interface CoreQueries {
  listRecordsPivoted(tableId: string, opts?, offset?, limit?): Promise<Array<{ id: string; cells: Record<string, unknown> }>>;
}

interface CoreFieldTypes {
  FieldType: Record<string, string>;
  formatNumberToString(n: number, opts: { precision?: number }): string;
  parseStringToNumber(input: string): number | null;
}

interface CoreServerApi {
  db: DrizzleLike;       // minimal drizzle face — avoids SDK depending on app schema
  schema: CoreSchema;
  queries: CoreQueries;
  fieldTypes: CoreFieldTypes;
}
```

The core services injected into plugin server routers. Plugins never import internal app modules — they receive this object.

### `ServerRouterFactory<TRouter>`

```typescript
type ServerRouterFactory<TRouter> = (core: CoreServerApi) => TRouter;
```

Factory pattern for a plugin-provided tRPC router. Constructed in `plugins.config.ts` with the app's `coreServerApi` and merged into the app router:

```typescript
const myServer: ServerRouterFactory<ReturnType<typeof buildRouter>> = (core) => buildRouter(core);
```

### `UiSlotContribution`

```typescript
interface UiSlotContribution {
  slotId: string;
  Component: unknown;  // at runtime a React component accepting { ctx?: unknown }
}
```

A client-side UI extension: `slotId` selects where the component mounts; `Component` receives a slot-specific `ctx` prop.

### `DrizzleLike`, `CoreSchema`, `CoreQueries`, `CoreFieldTypes`

Structural interfaces backing `CoreServerApi` (see above). They are deliberately loose (mostly `unknown`) so the SDK does not depend on the app's Drizzle schema.

## TypeScript Type Exports

```typescript
// Types
import type {
  StorageProvider,
  Contribution,
  PluginDefinition,
  CoreServerApi,
  DrizzleLike,
  CoreSchema,
  CoreQueries,
  CoreFieldTypes,
  ServerRouterFactory,
  UiSlotContribution,
  CellValue,
  FieldOptions,
  NormalizedCell,
  OptionsSchema,
  FieldTypeContribution,
  Registry,
} from '@markpocket/plugin-sdk';

// Values
import { createRegistry, definePlugin } from '@markpocket/plugin-sdk';

// tRPC helpers (subpath)
import { router, publicProcedure, protectedProcedure, type PluginContext } from '@markpocket/plugin-sdk/trpc';
```

| Export | Kind | Description |
|---|---|---|
| `createRegistry` | value | Registry factory (`register` / `get` / `tryGet` / `list`) |
| `definePlugin` | value | Identity helper with type checking for `PluginDefinition` |
| `router` / `publicProcedure` / `protectedProcedure` | value (trpc) | tRPC builders with `PluginContext` |
| `PluginContext` | type (trpc) | `{ session: { user: { id: string } } \| null }` |
| `Registry<T>` | type | Return type of `createRegistry` |
| `StorageProvider` | type | Storage backend capability surface |
| `Contribution<T>` | type | `{ name, impl }` named contribution |
| `PluginDefinition` | type | Plugin manifest |
| `CoreServerApi` | type | Core services injected into plugin routers |
| `ServerRouterFactory<TRouter>` | type | `(core) => TRouter` factory shape |
| `FieldTypeContribution` | type | Server-side field type value semantics |
| `UiSlotContribution` | type | Client UI slot extension |
| `CellValue` / `FieldOptions` / `NormalizedCell` / `OptionsSchema` | type | Field type building blocks |
| `DrizzleLike` / `CoreSchema` / `CoreQueries` / `CoreFieldTypes` | type | Interfaces backing `CoreServerApi` |

## Reference Implementations

- Storage plugin: `packages/plugin-storage-local/`
- Server router + UI slot plugin: `packages/plugin-csv/`
- Field type contributions: `apps/web/src/server/plugins/builtin-fields/`
- See `docs/plugin-development.md` for the full development guide.