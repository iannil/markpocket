'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export function CommandPalette({ bases }: { bases: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem value="Go to Bases" onSelect={() => go('/bases')}>
            Go to Bases
          </CommandItem>
          <CommandItem value="New base" onSelect={() => go('/bases/new')}>
            New base
          </CommandItem>
        </CommandGroup>
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
    </CommandDialog>
  );
}
