// apps/web/src/components/base-history-list.tsx
'use client';

import { useState } from 'react';

import { keepPreviousData } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { fmtTime, fmtVal } from '@/lib/format';
import { errorMessage, isPermissionError } from '@/lib/trpc-error';
import { trpc } from '@/lib/trpc/client';

interface HistoryRow {
  id: string;
  changedAt: string;
  changedByName: string | null;
  changedByEmail: string | null;
  tableName: string;
  fieldName: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const PAGE_SIZE = 50;

// Shared intro copy — the standalone page and the settings tab render the
// same description as the same list.
export const BASE_HISTORY_DESCRIPTION = 'All changes across this base, newest first.';

// Shared by the standalone /bases/<id>/history page and the settings tab so
// both render the same list without one redirecting out of its layout.
export function BaseHistoryList() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError, error } = trpc.history.listByBase.useQuery(
    { baseId, offset, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading history">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    // Permission failures are permanent — no Retry, or the user is sent into
    // an infinite loop of doomed retries.
    return (
      <div className="space-y-2 text-sm" role="alert">
        <p className="text-destructive">
          {isPermissionError(error)
            ? 'You do not have access to this base.'
            : `Failed to load history. ${errorMessage(error)}`}
        </p>
        {!isPermissionError(error) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void utils.history.listByBase.invalidate({ baseId })}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>;
  }

  const shown = data.rows.length;

  return (
    <div className="space-y-2">
      <table className="w-full text-sm" aria-label="Change history">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              When
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Who
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Table
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Field
            </th>
            <th scope="col" className="py-2 font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: HistoryRow) => {
            const change = `${fmtVal(r.oldValue)} → ${fmtVal(r.newValue)}`;
            return (
              <tr key={r.id} className="border-b border-border align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground">
                  {fmtTime(r.changedAt)}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-muted-foreground">
                  {r.changedByName ?? r.changedByEmail ?? 'unknown'}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground">
                  {r.tableName}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs font-medium">{r.fieldName}</td>
                <td className="max-w-0 truncate py-2 font-mono text-xs" title={change}>
                  {change}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown > 0 && offset + shown < data.total && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {offset + shown} of {data.total} changes.
          </span>
          <Button size="sm" variant="outline" onClick={() => setOffset(offset + PAGE_SIZE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
