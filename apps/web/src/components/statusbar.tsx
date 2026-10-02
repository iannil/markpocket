// apps/web/src/components/statusbar.tsx
'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { useLastSavedAt } from '@/lib/use-last-saved';

function relativeTime(secondsAgo: number | null): string {
  if (secondsAgo === null) return '';
  if (secondsAgo < 5) return 'saved just now';
  if (secondsAgo < 60) return `saved ${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `saved ${Math.floor(secondsAgo / 60)}m ago`;
  return `saved ${Math.floor(secondsAgo / 3600)}h ago`;
}

export function Statusbar({
  // Null (or 0) hides the indicator — outside a base there is no presence.
  onlineCount = null,
  // Reserved for the grid's conflict toast (LWW overwrite notice). Not wired
  // yet: pass null until the grid agent feeds real conflicts.
  lww = null,
  shortcuts = '↑↓ nav · ⌘K',
  variant = 'full',
}: {
  onlineCount?: number | null;
  lww?: { field: string; by: string } | null;
  shortcuts?: string;
  variant?: 'full' | 'compact';
}) {
  // "Saved" comes from the last successful tRPC mutation, ticked every 5s.
  const savedAt = useLastSavedAt();
  const [, tick] = useState(0);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [savedAt]);
  const savedSecondsAgo = savedAt === null ? null : Math.floor((Date.now() - savedAt) / 1000);

  const showOnline = onlineCount !== null && onlineCount > 0;

  return (
    <footer
      className={cn(
        'h-6 shrink-0 flex items-center justify-between px-3 text-[11px] font-mono',
        'bg-background border-t border-border text-muted-foreground',
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {showOnline && (
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-online" />
            {onlineCount} online
          </span>
        )}
        {variant === 'full' && savedSecondsAgo !== null && (
          <span className="truncate">{relativeTime(savedSecondsAgo)}</span>
        )}
        {variant === 'full' && lww && (
          <span className="text-destructive truncate">
            LWW: {lww.field} overwritten by @{lww.by}
          </span>
        )}
      </div>
      {variant === 'full' && (
        <div className="hidden md:block text-muted-foreground/70 shrink-0">{shortcuts}</div>
      )}
    </footer>
  );
}
