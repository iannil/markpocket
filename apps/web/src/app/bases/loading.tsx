// Segment-level skeleton: /bases/layout awaits base.list server-side, and
// without this file the first byte of the whole route waited on that query.
export default function BasesLoading() {
  return (
    <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
