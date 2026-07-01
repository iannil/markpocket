// apps/web/src/app/bases/layout.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AppShell } from '@/components/app-shell';
import { auth } from '@/server/auth';

export default async function BasesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');

  // TODO Task 1.6: 真实 bases 列表 + online presence 从 realtime 取
  const bases: never[] = [];
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
