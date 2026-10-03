'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';

import { trpc } from '@/lib/trpc/client';

export const PAGE_SIZE = 200;

export interface GroupLike {
  key: string | null;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
}
export interface RecordListData {
  groups: GroupLike[];
  total: number;
}

// Offset-based append pagination. The server caps a single request at
// limit<=1000, so the old "limit += 500" growth died on the third "Show more"
// (BAD_REQUEST); offset windows have no such ceiling.
//
// Window drift under concurrent writes: deletes make windows overlap (handled
// by the dedupe below) and inserts between page fetches can skip a record
// with no duplicate to notice. Every write publishes a ws broadcast and the
// RealtimeProvider invalidates record.list on arrival, which refetches all
// loaded pages and closes the hole — an auto-refetch heuristic here would
// false-positive on every legitimate overlap and storm the server. Keyset
// pagination is the structural fix if the design target grows.
function mergeGroups(datasets: Array<RecordListData | undefined>): GroupLike[] {
  const out: GroupLike[] = [];
  const byKey = new Map<string | null, GroupLike>();
  const seenRecordIds = new Set<string>();
  for (const data of datasets) {
    if (!data) continue;
    for (const g of data.groups) {
      const key = g.key ?? null;
      let target = byKey.get(key);
      if (!target) {
        target = { key, records: [] };
        byKey.set(key, target);
        out.push(target);
      }
      for (const r of g.records) {
        if (seenRecordIds.has(r.id)) continue;
        seenRecordIds.add(r.id);
        target.records.push(r);
      }
    }
  }
  return out;
}

export function usePagedRecords(
  tableId: string,
  viewId: string | undefined,
  // While the views query is still loading, activeViewId is not final yet —
  // fetching now would pull page 1 without a viewId and immediately re-pull
  // with one. The grid gates this on views being resolved.
  enabled = true,
) {
  const [pages, setPages] = useState(1);
  // A new view/table means a new ordering — the offset window starts over.
  // Adjusting during render (instead of an effect) avoids one render where the
  // new view is fetched with the old page count.
  const scopeKey = `${tableId}:${viewId ?? ''}`;
  const [lastScopeKey, setLastScopeKey] = useState(scopeKey);
  if (lastScopeKey !== scopeKey) {
    setLastScopeKey(scopeKey);
    setPages(1);
  }

  const offsets = useMemo(() => Array.from({ length: pages }, (_, i) => i * PAGE_SIZE), [pages]);
  const results = trpc.useQueries((qc) =>
    offsets.map((offset) =>
      qc.record.list(
        { tableId, viewId, offset, limit: PAGE_SIZE },
        // keepPreviousData: switching views keeps the old rows on screen instead
        // of flashing "No records." while the new view's pages are in flight.
        { placeholderData: keepPreviousData, enabled },
      ),
    ),
  );

  // useQueries hands back a fresh result array every render, so keying the
  // merge memo on `results` recomputed it on every keystroke/selection — the
  // new array references then cascaded through flatRows/rowNumberById/… and
  // broke every downstream memo. The signature below is the primitive-typed
  // stand-in: dataUpdatedAt is bumped on every fetch SET (placeholder swap,
  // refetch, retry — even when structural sharing keeps the data reference),
  // and the join implicitly encodes the page count, so any change to the
  // data (or which pages hold it) changes the signature. Nothing else feeds
  // mergeGroups.
  const resultsSignature = results.map((r) => r.dataUpdatedAt).join(',');
  const groups = useMemo(
    () => mergeGroups(results.map((r) => r.data)),
    // `results` is captured on purpose; recompute is gated on the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultsSignature],
  );
  const total =
    results.find((r) => r.data && !r.isPlaceholderData)?.data?.total ??
    results.find((r) => r.data != null)?.data?.total ??
    0;
  const recordsLoading = results[0]?.isPending ?? true;
  // Page 1 failing means there is nothing to show — full error state. Any
  // OTHER loaded page failing keeps the loaded rows on screen with a retry
  // banner instead. Filter the results, not the error list: with only page 2
  // failed, errorPages === [page2] and slicing THAT would drop the only error
  // entirely (silent data loss past row 200).
  const laterErrorPages = results.slice(1).filter((r) => r.isError);
  const firstPageError = results[0]?.isError ? (results[0].error ?? null) : null;

  return {
    groups,
    total,
    recordsLoading,
    recordsError: firstPageError,
    trailingPageError:
      laterErrorPages.length > 0
        ? {
            message: laterErrorPages[0]?.error?.message ?? '',
            retry: () => laterErrorPages.forEach((p) => void p.refetch()),
          }
        : null,
    retryRecords: () => {
      // Retry every failed page, page 1 included — the full-error screen has
      // nothing else worth refetching for.
      results.forEach((r) => {
        if (r.isError) void r.refetch();
      });
    },
    anyFetching: results.some((r) => r.isFetching),
    showMore: () => setPages((p) => p + 1),
  };
}
