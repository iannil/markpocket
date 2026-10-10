export function nextRowRequest(p: {
  targetRow: number;
  loaded: number;
  total: number;
  fetching: boolean;
}) {
  if (p.total === 0) return { kind: 'wait' } as const;
  const target = Math.max(0, Math.min(p.targetRow, p.total - 1));
  if (target < p.loaded) return { kind: 'select', row: target } as const;
  return p.fetching ? ({ kind: 'wait' } as const) : ({ kind: 'load', targetRow: target } as const);
}
