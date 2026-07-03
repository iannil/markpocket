// apps/web/src/components/app-shell.tsx
'use client';

import { Topbar, type CurrentUser } from './topbar';
import { Sidebar, type SidebarBase } from './sidebar';
import { Statusbar } from './statusbar';
import { CommandPalette } from './command-palette';
import { OnlineUser } from './online-avatars';
import { BreadcrumbProvider } from '@/lib/breadcrumb-context';
import { cn } from '@/lib/utils';

export function AppShell({
  onlineUsers = [],
  currentUser,
  bases = [],
  currentBaseId,
  statusbarVariant = 'full',
  children,
}: {
  onlineUsers?: OnlineUser[];
  currentUser?: CurrentUser;
  bases?: SidebarBase[];
  currentBaseId?: string;
  statusbarVariant?: 'full' | 'compact' | 'none';
  children: React.ReactNode;
}) {
  return (
    <BreadcrumbProvider>
      <div className="h-screen flex flex-col bg-background">
        <Topbar onlineUsers={onlineUsers} currentUser={currentUser} />
        <div className="flex-1 flex min-h-0">
          <Sidebar bases={bases} currentBaseId={currentBaseId} />
          <main className={cn('flex-1 min-w-0 flex flex-col')}>{children}</main>
        </div>
        {statusbarVariant !== 'none' && <Statusbar variant={statusbarVariant} />}
        <CommandPalette bases={bases} />
      </div>
    </BreadcrumbProvider>
  );
}
