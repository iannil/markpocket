// apps/web/src/lib/use-sidebar-collapsed.ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'mp:sidebar';
const MOBILE_BREAKPOINT = 1024;

// Shared module-level store: Topbar's toggle and Sidebar's width must observe
// the SAME state, or the button flips its icon while the sidebar never moves.
let cached: boolean | null = null; // null = not read yet (SSR / first render)
const listeners = new Set<() => void>();

function computeCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  // < 1024px auto-collapses (spec §5.8); otherwise stored preference wins.
  if (mq.matches) return true;
  return window.localStorage.getItem(KEY) === '1';
}

function getSnapshot(): boolean {
  if (cached === null) cached = computeCollapsed();
  return cached;
}

function getServerSnapshot(): boolean {
  return false;
}

function setCollapsedGlobal(v: boolean) {
  cached = v;
  window.localStorage.setItem(KEY, v ? '1' : '0');
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mq.addEventListener('change', () => {
    cached = mq.matches ? true : window.localStorage.getItem(KEY) === '1';
    listeners.forEach((l) => l());
  });
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot,
    getServerSnapshot,
  );

  const setCollapsed = useCallback((v: boolean) => setCollapsedGlobal(v), []);
  const toggle = useCallback(() => setCollapsedGlobal(!getSnapshot()), []);

  return { collapsed, toggle, setCollapsed };
}
