// apps/web/src/lib/command-palette.ts
'use client';

import { useSyncExternalStore } from 'react';

// Tiny external store for the palette's open state. The topbar button and
// the ⌘K listener share it without prop drilling; the previous approach —
// dispatching a synthetic meta+K KeyboardEvent — depended on cmdk honoring
// non-trusted events.
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setCommandPaletteOpen(next: boolean) {
  if (next !== open) {
    open = next;
    emit();
  }
}

export function toggleCommandPalette() {
  setCommandPaletteOpen(!open);
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
    // Server snapshot: the palette is never open during SSR (a missing
    // getServerSnapshot throws during server rendering and forces the whole
    // route into the client-rendering fallback).
    () => false,
  );
}
