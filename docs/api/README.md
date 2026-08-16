# API Documentation

markpocket uses **tRPC** (v11) for all client-server communication. There is no REST API — every operation is a typed procedure call.

## How It Works

tRPC provides end-to-end type safety: the client imports the `AppRouter` type and gets full TypeScript inference for every procedure, input, and output.

- **Procedures** are the API endpoints. Each is either a `query` (GET — idempotent, cached by React Query) or a `mutation` (POST — modifies data, invalidates caches).
- **Inputs** are validated at runtime with **Zod** schemas.
- **Router tree**: top-level routers are merged in `apps/web/src/server/trpc/router.ts` and exposed as `appRouter`.

## Client Setup

The client-side provider is in `apps/web/src/lib/trpc/client.tsx`.

```tsx
import { trpc, TRPCProvider } from '@/lib/trpc/client';

// Wrap your app root with the provider
function RootLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}

// Use in any component
function MyComponent() {
  const baseList = trpc.base.list.useQuery();
  const createBase = trpc.base.create.useMutation();
}
```

The client uses `httpBatchLink` — all requests in a single render pass are batched into one HTTP POST to `/api/trpc`. In SSR, the base URL defaults to `http://localhost:3000`.

## Context & Auth

Defined in `apps/web/src/server/trpc/init.ts`.

### Context

Each request creates a context containing the session object:

```ts
{ session: Session | null }
```

The session is fetched from **better-auth** via `auth.api.getSession({ headers })`.

### Procedures

Two procedure builders are exported:

- `publicProcedure` — no auth required. Available to unauthenticated requests.
- `protectedProcedure` — **requires a valid session**. Returns `UNAUTHORIZED` (401) if the user is not signed in. After auth, the context is narrowed to `{ session: Session }` (non-null).

### Role-Based Access

Many mutations perform an additional role check via `assertRole(baseId, userId, minRole)`. The role hierarchy is:

```
viewer < editor < owner
```

- `viewer` — read-only access
- `editor` — can create/update/delete content
- `owner` — can manage members and delete the base

See `apps/web/src/lib/roles.ts` for implementation.

## Router Structure

The top-level router (`apps/web/src/server/trpc/router.ts`) merges:

| Namespace | Router File | Description |
|-----------|-------------|-------------|
| `auth` | `routers/auth.ts` | Session and user listing |
| `workspace` | `routers/workspace.ts` | Default workspace management |
| `base` | `routers/base.ts` | Base CRUD |
| `table` | `routers/table.ts` | Table CRUD within a base |
| `view` | `routers/view.ts` | View CRUD and options |
| `field` | `routers/field.ts` | Field CRUD and options |
| `record` | `routers/record.ts` | Record listing and CRUD |
| `cell` | `routers/cell.ts` | Cell value upsert with expression recomputation |
| `export` | `routers/export.ts` | Base export to CSV |
| `history` | `routers/history.ts` | Cell-level change history |
| `invite` | `routers/invite.ts` | Invite management (create, resolve, accept) |
| `share` | `routers/share.ts` | Public share link management |
| `member` | `routers/member.ts` | Base membership management |
| `publicShare` | `routers/public-share.ts` | Unauthenticated public share data access |

Plugin routers are spread in from `plugins.config.ts` at the top level.

## Realtime

After any mutation that modifies base data, a **Postgres NOTIFY** is sent via `publishBaseChange(baseId)` or `publishTableChange(tableId)`. The WebSocket gateway picks this up and broadcasts to all connected clients subscribed to that base's channel. This is soft real-time (Last-Write-Wins, no OT/CRDT).