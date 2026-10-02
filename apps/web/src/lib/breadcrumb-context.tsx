// apps/web/src/lib/breadcrumb-context.tsx
'use client';
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { BreadcrumbSegment } from '@/components/breadcrumb';

const WORKSPACE_SEGMENTS: BreadcrumbSegment[] = [{ label: 'Workspace', href: '/bases' }];

interface BreadcrumbCtx {
  /** Combined chain for display: base prefix + page leaf. */
  segments: BreadcrumbSegment[];
  /** Leaf-level setter — pages set ONLY their own trailing segment(s). */
  setSegments: (s: BreadcrumbSegment[]) => void;
  /** Base-level setter — the base layout owns the "Workspace ▸ Base" prefix. */
  setBaseSegments: (s: BreadcrumbSegment[]) => void;
}

const Ctx = createContext<BreadcrumbCtx>({
  segments: WORKSPACE_SEGMENTS,
  setSegments: () => {},
  setBaseSegments: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  // Two independent slots combined at display time: layouts and pages mount in
  // unpredictable relative order (child effects run first), so a single
  // "set the whole chain" API would let one side clobber the other.
  const [base, setBaseSegments] = useState<BreadcrumbSegment[]>(WORKSPACE_SEGMENTS);
  const [leaf, setSegments] = useState<BreadcrumbSegment[]>([]);
  const segments = useMemo(() => [...base, ...leaf], [base, leaf]);

  return <Ctx.Provider value={{ segments, setSegments, setBaseSegments }}>{children}</Ctx.Provider>;
}

export function useBreadcrumb() {
  return useContext(Ctx).segments;
}

/** Pages set only their trailing segment(s), e.g. [{ label: 'Members' }]. */
export function useBreadcrumbSetter(segments: BreadcrumbSegment[]) {
  const { setSegments } = useContext(Ctx);
  const key = JSON.stringify(segments);
  useEffect(() => {
    setSegments(segments);
    return () => setSegments([]);
    // `key` (the serialized segments) is the change signal — `segments` identity
    // is unstable per render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSegments]);
}

/** Base layout sets the "Workspace ▸ Base" prefix shared by all its pages. */
export function useBaseBreadcrumbSetter(baseId: string, baseName: string | null) {
  const { setBaseSegments } = useContext(Ctx);
  useEffect(() => {
    setBaseSegments([
      { label: 'Workspace', href: '/bases' },
      { label: baseName ?? 'Base', href: `/bases/${baseId}` },
    ]);
    return () => setBaseSegments(WORKSPACE_SEGMENTS);
  }, [baseId, baseName, setBaseSegments]);
}
