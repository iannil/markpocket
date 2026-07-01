// apps/web/src/components/breadcrumb.tsx
'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BreadcrumbSegment = {
  label: string;
  href?: string;
};

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <nav className="flex items-center gap-0.5 text-sm min-w-0">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5 min-w-0">
            {seg.href && !isLast ? (
              <Link
                href={seg.href}
                className="text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted truncate max-w-[180px]"
              >
                {seg.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'px-1.5 py-0.5 truncate max-w-[220px]',
                  isLast ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {seg.label}
              </span>
            )}
            {!isLast && <ChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />}
          </div>
        );
      })}
    </nav>
  );
}
