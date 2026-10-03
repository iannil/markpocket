'use client';

import { useEffect } from 'react';
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
import { setCommandPaletteOpen, useCommandPaletteOpen } from '@/lib/command-palette';

export function CommandPalette({
  bases,
  tables = [],
}: {
  bases: Array<{ id: string; name: string }>;
  /** Tables of the CURRENT base (when one is open) for quick jumps. */
  tables?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const open = useCommandPaletteOpen();
  // useParams is untyped for arbitrary segments — validate the shape instead
  // of asserting it.
  const params = useParams();
  const currentBaseId =
    typeof params?.baseId === 'string' && params.baseId.length > 0 ? params.baseId : undefined;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `open` read via closure on purpose: re-binding per open change keeps
    // the toggle semantics without stale state.
  }, [open]);

  function go(href: string) {
    setCommandPaletteOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setCommandPaletteOpen}>
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem value="Go to Bases" onSelect={() => go('/bases')}>
              Go to Bases
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="New base" onSelect={() => go('/bases/new')}>
              New base
            </CommandItem>
          </CommandGroup>
          {currentBaseId && (
            <CommandGroup heading="Base">
              {tables.length > 0 &&
                tables.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`Go to ${t.name}`}
                    onSelect={() => go(`/bases/${currentBaseId}/tables/${t.id}`)}
                  >
                    Go to {t.name}
                  </CommandItem>
                ))}
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
