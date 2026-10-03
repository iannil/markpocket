'use client';

// Segment-level error boundary: keeps the AppShell (sidebar/topbar/statusbar)
// mounted and swaps only the content area, instead of escalating to the
// app-level full-page error.
export default function BasesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-sm font-semibold text-destructive">Something went wrong</h1>
      <p className="text-xs text-muted-foreground">
        This view failed to load. Trying again may help.
      </p>
      <button
        onClick={reset}
        className="mt-2 h-8 rounded-md border border-input px-3 text-sm hover:bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
