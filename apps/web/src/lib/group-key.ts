/** Shared grouping identity: empty cells use null; every literal string stays distinct. */
export function groupKey(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}
