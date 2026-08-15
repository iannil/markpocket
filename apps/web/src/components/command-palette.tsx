'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export function CommandPalette({ bases }: { bases: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const params = useParams();
  const [open, setOpen] = useState(false);

  const currentBaseId = params?.baseId as string | undefined;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem value="Go to Bases" onSelect={() => go('/bases')}>
              Go to Bases
            </CommandItem>
            <CommandItem value="Create new base" onSelect={() => go('/bases/new')}>
              Create new base
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="New base" onSelect={() => go('/bases/new')}>
              New base
            </CommandItem>
          </CommandGroup>
          {currentBaseId && (
            <CommandGroup heading="Base">
              <CommandItem
                value="Go to Settings"
                onSelect={() => go(`/bases/${currentBaseId}/settings`)}
              >
                Go to Settings
              </CommandItem>
              <CommandItem
                value="View History"
                onSelect={() => go(`/bases/${currentBaseId}/history`)}
              >
                View History
              </CommandItem>
            </CommandGroup>
          )}
          {bases.length > 0 && (
            <CommandGroup heading="Bases">
              {bases.map((b) => (
                <CommandItem key={b.id} value={b.name} onSelect={() => go(`/bases/${b.id}`)}>
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
