// apps/web/src/app/bases/layout.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AppShell } from '@/components/app-shell';
import { auth } from '@/server/auth';
import { api } from '@/server/trpc/caller';

export default async function BasesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');

  // Fetch real bases from database via tRPC
  const apiCaller = await api();
  const baseRows = await apiCaller.base.list();
  const bases = baseRows.map((b) => ({
    id: b.id,
    name: b.name,
    tables: [], // Task 1.6: table-level expansion is a later concern
  }));

  // Topbar-level presence avatars are a redesign-phase item; per-base presence
  // is already live inside the table page via <PresenceBar>.
  const onlineUsers: never[] = [];

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
      onlineUsers={onlineUsers}
    >
      {children}
    </AppShell>
  );
}
