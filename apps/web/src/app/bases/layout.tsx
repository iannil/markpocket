import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { AppShell } from '@/components/app-shell';
import { auth } from '@/server/auth';
import { api } from '@/server/trpc/caller';

export const metadata: Metadata = {
  title: 'Workspace',
};

export default async function BasesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');

  // Fetch real bases from database via tRPC (RSC) — handed to the shell and,
  // via context, to client pages as initialData so nothing re-fetches it.
  const apiCaller = await api();
  const baseRows = await apiCaller.base.list();
  // Normalize timestamps to ISO strings — the same shape the client-side
  // query would produce over the HTTP link.
  const baseListRows = baseRows.map((b) => ({
    ...b,
    createdAt: new Date(b.createdAt).toISOString(),
  }));
  const bases = baseListRows.map((b) => ({
    id: b.id,
    name: b.name,
    // The open base's tables are filled in by the shell (client-side query).
    tables: [],
  }));

  return (
    <AppShell
      currentUser={
        session.user
          ? {
              id: session.user.id,
              name: session.user.name ?? session.user.email ?? 'me',
              avatarUrl: session.user.image ?? null,
            }
          : undefined
      }
      bases={bases}
      baseListRows={baseListRows}
    >
      {children}
    </AppShell>
  );
}
