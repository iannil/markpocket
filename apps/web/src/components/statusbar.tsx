// apps/web/src/components/statusbar.tsx
'use client';

import { cn } from '@/lib/utils';

function relativeTime(secondsAgo: number | null): string {
  if (secondsAgo === null) return '';
  if (secondsAgo < 5) return 'saved just now';
  if (secondsAgo < 60) return `saved ${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `saved ${Math.floor(secondsAgo / 60)}m ago`;
  return `saved ${Math.floor(secondsAgo / 3600)}h ago`;
}

export function Statusbar({
  onlineCount = 1,
  savedSecondsAgo = null,
  lww = null,
  shortcuts = '↑↓ nav · ⌘K',
  variant = 'full',
}: {
  onlineCount?: number;
  savedSecondsAgo?: number | null;
  lww?: { field: string; by: string } | null;
  shortcuts?: string;
  variant?: 'full' | 'compact';
}) {
  return (
    <footer
      className={cn(
        'h-6 shrink-0 flex items-center justify-between px-3 text-[11px] font-mono',
        'bg-background border-t border-border text-muted-foreground',
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-online" />
          {onlineCount} online
        </span>
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
