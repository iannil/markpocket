// Shared classification of tRPC client errors for UI states. Permission
// failures (FORBIDDEN/UNAUTHORIZED) are permanent — retrying can never
// succeed — so they must be presented as an access problem, never as
// transient network trouble with a Retry button.
export function isPermissionError(e: unknown): boolean {
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  return code === 'FORBIDDEN' || code === 'UNAUTHORIZED';
}

// Stable message for an error branch; falls back to a generic sentence so
// UIs never render an empty/undefined message for non-Error throwables.
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong.';
}
