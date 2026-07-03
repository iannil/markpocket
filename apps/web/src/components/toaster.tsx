'use client';

import { useSyncExternalStore } from 'react';

import { subscribeToasts, getToasts, dismissToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-none',
            t.kind === 'error' ? 'border-destructive/40 text-destructive' : 'border-border',
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
