export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col" role="status" aria-label="Loading page">
      {/* Top ink loading bar (spec §7.4) — indeterminate sweep while a route
          segment resolves. */}
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
        <div className="mp-loading-bar h-full w-full bg-foreground" />
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
