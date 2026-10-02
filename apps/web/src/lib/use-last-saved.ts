// apps/web/src/lib/use-last-saved.ts
'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Tracks the timestamp of the last SUCCESSFUL tRPC mutation (all tRPC mutations
// go through the shared react-query MutationCache). Powers the statusbar
// "saved Ns ago" indicator without touching every call site.

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
