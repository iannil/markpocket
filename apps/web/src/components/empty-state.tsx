import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  description,
  action,
  className,
  as = 'h3',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * Heading level for the title. Full-page states (error, 404) are the
   * document's only heading and must be h1; in-page empty states render as
   * h3 under the page's own h1/h2.
   */
  as?: 'h1' | 'h2' | 'h3';
}) {
  const Heading = as;
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-4 py-16 text-center', className)}
    >
      <Heading className="text-sm font-medium text-foreground">{title}</Heading>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
