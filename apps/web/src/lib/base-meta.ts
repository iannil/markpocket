// apps/web/src/lib/base-meta.ts
// Server-only helper for generateMetadata in layouts under /bases/[baseId].
// Import from server components only (it hits the tRPC server caller).
import { api } from '@/server/trpc/caller';

export async function baseName(baseId: string): Promise<string | null> {
  try {
    const caller = await api();
    const row = await caller.base.get({ id: baseId });
    return row?.name ?? null;
  } catch {
    // Unauthenticated or no membership — the page itself will handle it.
    return null;
  }
}
