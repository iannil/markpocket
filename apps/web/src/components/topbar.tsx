// apps/web/src/components/topbar.tsx
'use client';

import { PanelLeftClose, PanelLeft, Command } from 'lucide-react';
import { Breadcrumb } from './breadcrumb';
import { OnlineAvatars, type OnlineUser } from './online-avatars';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { useBreadcrumb } from '@/lib/breadcrumb-context';
import { cn } from '@/lib/utils';

export type CurrentUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export function Topbar({
  onlineUsers = [],
  currentUser,
}: {
  onlineUsers?: OnlineUser[];
  currentUser?: CurrentUser;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const breadcrumb = useBreadcrumb();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-10 flex items-center gap-2 px-3',
        'bg-background/95 backdrop-blur-sm border-b border-border',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className="size-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar (⌘\\)' : 'Collapse sidebar (⌘\\)'}
      >
        {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
      </button>

      <div className="flex-1 min-w-0">
        <Breadcrumb segments={breadcrumb} />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {onlineUsers.length > 0 && <OnlineAvatars users={onlineUsers} />}
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
            )
          }
          className="hidden h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground md:inline-flex"
          title="Command palette (⌘K)"
        >
          <Command className="size-2.5" />K
        </button>
        {currentUser && (
          <div
            className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-mono"
            title={currentUser.name}
          >
            {currentUser.name
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join('')}
          </div>
        )}
      </div>
    </header>
  );
}
