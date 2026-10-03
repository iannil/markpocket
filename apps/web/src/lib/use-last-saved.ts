// apps/web/src/lib/use-last-saved.ts
'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Tracks the timestamp of the last SUCCESSFUL tRPC mutation (all tRPC mutations
// go through the shared react-query MutationCache). Powers the statusbar
// "saved Ns ago" indicator without touching every call site.
//
// Scope note: the cache is per-tab and mutations only ever fire against the
// base the visible page acts on, so "any successful mutation" and "any
// successful mutation for this base" coincide in practice; scoping by an
// explicit baseId would mean threading meta through every call site.

export function useLastSavedAt(): number | null {
  const queryClient = useQueryClient();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const mutationCache = queryClient.getMutationCache();
    return mutationCache.subscribe((event) => {
      if (event?.type === 'updated' && event.mutation.state.status === 'success') {
        setSavedAt(Date.now());
      }
    });
  }, [queryClient]);

  return savedAt;
}
