// apps/web/src/lib/bases-context.tsx
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/trpc/router';

export type BaseListRow = inferRouterOutputs<AppRouter>['base']['list'][number];

// The /bases layout already fetched base.list on the server (RSC); this context
// hands those rows to client pages as query initialData so they do not re-fetch
// the same data on mount.
const Ctx = createContext<BaseListRow[]>([]);

export function BasesListProvider({
  rows,
  children,
}: {
  rows: BaseListRow[];
  children: ReactNode;
}) {
  return <Ctx.Provider value={rows}>{children}</Ctx.Provider>;
}

export function useBasesList(): BaseListRow[] {
  return useContext(Ctx);
}
