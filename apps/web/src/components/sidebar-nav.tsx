'use client';

import { Database, Hash, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: bases } = trpc.base.list.useQuery();

  // Extract current baseId from URL (/bases/[baseId]/...)
  const segments = pathname.split('/');
  const baseIdx = segments.indexOf('bases');
  const currentBaseId = baseIdx >= 0 ? segments[baseIdx + 1] : null;

  const { data: currentTables } = trpc.table.list.useQuery(
    { baseId: currentBaseId! },
    { enabled: !!currentBaseId },
  );

  const createBase = trpc.base.create.useMutation({
    onSuccess: () => utils.base.list.invalidate(),
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const currentTableId = segments.includes('tables')
    ? segments[segments.indexOf('tables') + 1]
    : null;

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <Link
        href="/bases"
        className="flex items-center gap-2 px-4 py-4 transition-colors hover:bg-sidebar-accent"
      >
        <span className="text-lg font-bold tracking-tight text-primary">◈</span>
        <span className="text-lg font-bold tracking-tight text-foreground">markpocket</span>
      </Link>

      {/* Bases */}
      <div className="flex-1 overflow-auto px-2">
        <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bases
        </div>
        {bases?.map((b) => {
          const isCurrent = b.id === currentBaseId;
          return (
            <div key={b.id}>
              <Link
                href={`/bases/${b.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isCurrent
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{b.name}</span>
              </Link>
              {/* Tables under current base */}
              {isCurrent && currentTables && (
                <div className="ml-4 border-l border-sidebar-border pl-1">
                  {currentTables.map((t) => {
                    const active = t.id === currentTableId;
                    return (
                      <Link
                        key={t.id}
                        href={`/bases/${b.id}/tables/${t.id}`}
                        className={cn(
                          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
                          active
                            ? 'bg-sidebar-accent font-medium text-primary'
                            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50',
                        )}
                      >
                        <Hash className="h-3 w-3 opacity-50" />
                        <span className="truncate">{t.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Add base */}
        <div className="pt-2">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                createBase.mutate(
                  { name: name.trim() },
                  { onSuccess: (nb) => router.push(`/bases/${nb.id}`) },
                );
                setAdding(false);
                setName('');
              }}
              className="flex items-center gap-1 px-1"
            >
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  setAdding(false);
                  setName('');
                }}
                placeholder="Base name"
                className="h-7 border-sidebar-border bg-sidebar-accent/30 text-xs"
              />
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> New base
            </button>
          )}
        </div>
      </div>

      {/* User footer */}
      <div className="border-t border-sidebar-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
          onClick={async () => {
            await authClient.signOut();
            router.push('/login');
          }}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
