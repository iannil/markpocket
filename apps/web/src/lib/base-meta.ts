// apps/web/src/lib/base-meta.ts
// Server-only helper for generateMetadata in layouts under /bases/[baseId].
// Import from server components only (it hits the tRPC server caller).
import { cache } from 'react';

import { api } from '@/server/trpc/caller';

// cache(): a base route's generateMetadata and any sibling lookups in the
// same request share one base.get instead of one per call site.
export const baseName = cache(async (baseId: string): Promise<string | null> => {
  try {
    const caller = await api();
    const row = await caller.base.get({ id: baseId });
    return row?.name ?? null;
  } catch (err) {
    // Unauthenticated / no membership is expected — the page itself handles
    // rejection and the title falls back. Anything else (DB outage) deserves
    // a log line instead of a silent title downgrade.
    const code = (err as { code?: string })?.code;
    if (code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN') {
      console.warn('baseName lookup failed:', err);
    }
    return null;
  }
});
