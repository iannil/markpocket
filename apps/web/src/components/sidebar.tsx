// apps/web/src/components/sidebar.tsx
'use client';

import Link from 'next/link';
import { Database, Users, Settings, Plus } from 'lucide-react';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { cn } from '@/lib/utils';

export type SidebarBase = {
  id: string;
  name: string;
  tables: { id: string; name: string }[];
};

export function Sidebar({
  bases,
  currentBaseId,
  workspaceName = 'Workspace',
}: {
  bases: SidebarBase[];
  currentBaseId?: string;
  workspaceName?: string;
}) {
  const { collapsed } = useSidebarCollapsed();
  const width = collapsed ? 'w-12' : 'w-60';

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-sidebar text-sidebar-foreground',
        'flex flex-col transition-[width] duration-150',
        width,
      )}
    >
      {/* workspace name */}
      <div className="h-10 flex items-center px-3 border-b border-sidebar-border shrink-0">
        {collapsed ? (
          <Database className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-sm font-medium truncate">{workspaceName}</span>
        )}
      </div>

      {/* bases list */}
      <nav className="flex-1 overflow-y-auto py-2">
        {!collapsed && bases.length > 0 && (
          <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {bases.length} {bases.length === 1 ? 'base' : 'bases'}
          </div>
        )}
        <ul className="px-1.5 space-y-0.5">
          {bases.map((base) => {
            const isCurrent = base.id === currentBaseId;
            return (
              <li key={base.id} className="group/row relative">
                <Link
                  href={`/bases/${base.id}`}
                  className={cn(
                    'group relative flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                    isCurrent
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                    collapsed && 'justify-center',
                  )}
                  title={collapsed ? base.name : undefined}
                >
                  {isCurrent && (
                    <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-foreground" />
                  )}
                  <Database className="size-3.5 shrink-0 text-muted-foreground" />
                  {!collapsed && <span className="truncate">{base.name}</span>}
                </Link>
                {!collapsed && (
                  <Link
                    href={`/bases/${base.id}/settings`}
                    title="Base settings"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/row:opacity-100"
                  >
                    <Settings className="size-3.5" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        {!collapsed && (
          <div className="px-1.5 pt-1">
            <Link
              href="/bases/new"
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              <span>new base</span>
            </Link>
          </div>
        )}
      </nav>

      {/* bottom fixed */}
      <div className="border-t border-sidebar-border p-1.5 space-y-0.5 shrink-0">
        <Link
          href="/members"
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            collapsed && 'justify-center',
          )}
          title={collapsed ? 'Members' : undefined}
        >
          <Users className="size-3.5" />
          {!collapsed && <span>members</span>}
        </Link>
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            collapsed && 'justify-center',
          )}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="size-3.5" />
          {!collapsed && <span>settings</span>}
        </Link>
      </div>
    </aside>
  );
}
