// apps/web/src/components/statusbar.tsx
'use client';

import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useLastSavedAt } from '@/lib/use-last-saved';

function relativeTime(secondsAgo: number | null): string {
  if (secondsAgo === null) return '';
  if (secondsAgo < 5) return 'saved just now';
  if (secondsAgo < 60) return `saved ${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `saved ${Math.floor(secondsAgo / 60)}m ago`;
  return `saved ${Math.floor(secondsAgo / 3600)}h ago`;
}

const SHORTCUT_GROUPS: Array<{ heading: string; items: [string, string][] }> = [
  {
    heading: 'Move',
    items: [
      ['↑ ↓ ← →', 'Move selection'],
      ['Ctrl + arrow', 'First/last row or column'],
      ['Home / End', 'Row edges (Ctrl: table edges)'],
      ['PageUp / PageDown', 'Jump a page of rows'],
      ['Tab / Shift+Tab', 'Next / previous cell'],
    ],
  },
  {
    heading: 'Edit',
    items: [
      ['Enter', 'Edit cell / toggle checkbox'],
      ['Any character', 'Type over (replaces value)'],
      ['Space', 'Toggle checkbox'],
      ['Delete / Backspace', 'Clear cell (undoable)'],
      ['Esc', 'Close editor / clear selection'],
    ],
  },
  {
    heading: 'Elsewhere',
    items: [
      ['⌘C / ⌘V', 'Copy / paste cell'],
      ['⌘K', 'Command palette'],
      ['?', 'This cheat sheet'],
    ],
  },
];

function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        {/* Single column: the dialog is max-w-sm, where the previous 2-col
            grid wrapped every description to 2-3 lines and pushed the
            content past the viewport. */}
        <div className="space-y-3">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.heading}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.heading}
              </h3>
              <dl className="space-y-1">
                {g.items.map(([keys, desc]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {keys}
                    </dt>
                    <dd className="min-w-0 text-right text-muted-foreground">{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [savedAt]);
  const savedSecondsAgo = savedAt === null ? null : Math.floor((Date.now() - savedAt) / 1000);

  // "?" opens the cheat sheet — only when nothing is being typed into.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '?') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <div className="hidden md:flex shrink-0 items-center gap-2 text-muted-foreground/70">
          <span className="hidden lg:inline">{shortcuts}</span>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="rounded px-1 hover:text-foreground"
          >
            ?
          </button>
        </div>
      )}
      {variant === 'full' && <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />}
    </footer>
  );
}
