// apps/web/src/lib/use-sidebar-collapsed.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'mp:sidebar';
const MOBILE_BREAKPOINT = 1024;

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    if (stored === '1') setCollapsedState(true);
    // < 1024px 自动折叠（spec §5.8）
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    if (mq.matches) setCollapsedState(true);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsedState(true);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, v ? '1' : '0');
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  return { collapsed, toggle, setCollapsed };
}
