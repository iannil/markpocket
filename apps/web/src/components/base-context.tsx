// apps/web/src/components/base-context.tsx
'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

import { useRealtime } from '@/components/realtime/realtime-provider';
import { useBaseBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';

export interface BaseInfo {
  baseId: string;
  baseName: string | null;
}

const Ctx = createContext<BaseInfo | null>(null);

// Mount once per base route (bases/[baseId]/layout):
// - subscribes to the base's realtime channel (presence + change events),
// - sets the "Workspace ▸ Base" breadcrumb prefix for all its pages,
// - exposes the base id/name to descendants (headers, titles).
export function BaseContextProvider({ baseId, children }: { baseId: string; children: ReactNode }) {
  const { subscribe, unsubscribe } = useRealtime();
  const { data } = trpc.base.get.useQuery({ id: baseId });
  const baseName = data?.name ?? null;
  useBaseBreadcrumbSetter(baseId, baseName);

  useEffect(() => {
    subscribe(baseId);
    return () => unsubscribe(baseId);
  }, [baseId, subscribe, unsubscribe]);

  return <Ctx.Provider value={{ baseId, baseName }}>{children}</Ctx.Provider>;
}

// Returns null outside a base route (e.g. /bases, /login).
export function useBaseInfo(): BaseInfo | null {
  return useContext(Ctx);
}
