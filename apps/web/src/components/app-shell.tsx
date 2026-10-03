// apps/web/src/components/app-shell.tsx
'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { skipToken } from '@tanstack/react-query';

import { Topbar, type CurrentUser } from './topbar';
import { Sidebar, type SidebarBase } from './sidebar';
import { Statusbar } from './statusbar';
import { CommandPalette } from './command-palette';
import type { OnlineUser } from './online-avatars';
import { usePresence } from '@/components/realtime/realtime-provider';
import { BasesListProvider, type BaseListRow } from '@/lib/bases-context';
import { BreadcrumbProvider } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

// Current base id from the URL ("/bases/<id>/...", excluding the literal
// "new" page). Layouts cannot read child-segment params, so pathname parsing
// is the pragmatic way for the shell to know which base is open.
function useCurrentBaseId(): string | undefined {
  const pathname = usePathname();
  const match = pathname?.match(/^\/bases\/([^/]+)/);
  const segment = match?.[1];
  return segment && segment !== 'new' ? segment : undefined;
}

export function AppShell({
  baseListRows = [],
  currentUser,
  bases = [],
  statusbarVariant = 'full',
  children,
}: {
  // Raw base.list rows fetched by the RSC layout — fed to pages via context
  // so /bases does not fetch them a second time.
  baseListRows?: BaseListRow[];
  currentUser?: CurrentUser;
  bases?: SidebarBase[];
  statusbarVariant?: 'full' | 'compact' | 'none';
  children: React.ReactNode;
}) {
  const currentBaseId = useCurrentBaseId();

  // Presence: the base layout subscribes; the shared RealtimeProvider holds
  // the user list, so the shell can render it in Topbar/Statusbar.
  const presenceUsers = usePresence(currentBaseId ?? '');
  const onlineUsers = useMemo<OnlineUser[]>(
    () =>
      presenceUsers.map((u) => ({
        id: u.userId,
        name: u.userName || u.userId.slice(0, 8),
        avatarUrl: null,
      })),
    [presenceUsers],
  );

  // Sidebar shows the current base's tables as a second level (spec §5.3).
  // skipToken (v5 idiom) instead of a non-null assertion: the query key is
  // honest about being disabled outside a base.
  const { data: currentTables } = trpc.table.list.useQuery(
    currentBaseId ? { baseId: currentBaseId } : skipToken,
  );
  const sidebarBases = useMemo<SidebarBase[]>(() => {
    if (!currentBaseId || !currentTables) return bases;
    return bases.map((b) =>
      b.id === currentBaseId
        ? { ...b, tables: currentTables.map((t) => ({ id: t.id, name: t.name })) }
        : b,
    );
  }, [bases, currentBaseId, currentTables]);

  return (
    <BreadcrumbProvider>
      <BasesListProvider rows={baseListRows}>
        <div className="h-screen flex flex-col bg-background">
          <Topbar onlineUsers={onlineUsers} currentUser={currentUser} />
          <div className="flex-1 flex min-h-0">
            <Sidebar bases={sidebarBases} currentBaseId={currentBaseId} />
            <main className={cn('flex-1 min-w-0 flex flex-col')}>{children}</main>
          </div>
          {statusbarVariant !== 'none' && (
            <Statusbar
              variant={statusbarVariant}
              onlineCount={currentBaseId ? onlineUsers.length : null}
            />
          )}
          <CommandPalette
            bases={sidebarBases}
            tables={currentBaseId ? (currentTables ?? []) : []}
          />
        </div>
      </BasesListProvider>
    </BreadcrumbProvider>
  );
}
