'use client';

import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { AppRouter } from '@/server/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

// The provider runs in the browser only (every data hook here is
// client-side); the empty prefix makes requests same-origin. Deliberately no
// server branch: an SSR prefetch would need the real request origin (from
// headers()), and a hardcoded fallback silently pointed at the wrong host.
function getBaseUrl() {
  return '';
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  // Grid data changes via WS invalidation, not focus — refetchOnWindowFocus would
  // repaint the whole grid on every tab switch for no benefit.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: `${getBaseUrl()}/api/trpc` })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
