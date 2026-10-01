// apps/web/src/lib/breadcrumb-context.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { BreadcrumbSegment } from '@/components/breadcrumb';

const DEFAULT_SEGMENTS: BreadcrumbSegment[] = [{ label: 'Workspace' }];

const Ctx = createContext<{
  segments: BreadcrumbSegment[];
  setSegments: (s: BreadcrumbSegment[]) => void;
}>({ segments: DEFAULT_SEGMENTS, setSegments: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[]>(DEFAULT_SEGMENTS);
  return <Ctx.Provider value={{ segments, setSegments }}>{children}</Ctx.Provider>;
}

export function useBreadcrumb() {
  return useContext(Ctx).segments;
}

export function useBreadcrumbSetter(segments: BreadcrumbSegment[]) {
  const { setSegments } = useContext(Ctx);
  const key = JSON.stringify(segments);
  useEffect(() => {
    setSegments(segments);
    return () => setSegments(DEFAULT_SEGMENTS);
    // `key` (the serialized segments) is the change signal — `segments` identity
    // is unstable per render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSegments]);
}
