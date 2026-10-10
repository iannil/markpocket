'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import type { ViewOptions } from '@/lib/view-ast';

function createSession(
  tableId: string,
  viewId: string,
  options: Record<string, unknown> | ViewOptions,
) {
  return {
    tableId,
    viewId,
    source: options,
    draft: options as Record<string, unknown>,
    committed: options as Record<string, unknown>,
    pending: 0,
    active: true,
    queue: Promise.resolve(),
  };
}

export function useGridViewOptions(
  tableId: string,
  viewId: string,
  options: Record<string, unknown> | ViewOptions,
) {
  const utils = trpc.useUtils();
  const mutation = trpc.view.updateOptions.useMutation();
  const [, renderDraft] = useState(0);
  const current = useRef(createSession(tableId, viewId, options));
  if (current.current.tableId !== tableId || current.current.viewId !== viewId) {
    current.current.active = false;
    current.current = createSession(tableId, viewId, options);
  }
  const session = current.current;
  if (session.source !== options) {
    session.source = options;
    // A refetch from an earlier commit cannot replace a newer local edit.
    if (!session.pending) session.draft = session.committed = options as Record<string, unknown>;
  }
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
    };
  }, [session]);

  function patchOptions(patch: Partial<ViewOptions>) {
    if (!session.active) return;
    const next: Record<string, unknown> = { ...session.draft, ...patch };
    session.draft = next;
    session.pending++;
    renderDraft((n) => n + 1);
    // Include the authoritative refetch in the queue, so writes and their
    // cache reconciles settle in order. Unsent work loses ownership on navigation.
    session.queue = session.queue.then(async () => {
      if (!session.active) return;
      try {
        const rowAffecting = ['filter', 'sort', 'group'].some(
          (key) => JSON.stringify(session.committed[key]) !== JSON.stringify(next[key]),
        );
        await mutation.mutateAsync({ id: session.viewId, options: next });
        session.committed = next;
        // A sent request still refreshes its own scopes after navigation.
        await Promise.all([
          utils.view.list.invalidate({ tableId: session.tableId }),
          ...(rowAffecting
            ? [
                utils.record.list.invalidate({ tableId: session.tableId, viewId: session.viewId }),
                utils.record.groupCounts.invalidate({
                  tableId: session.tableId,
                  viewId: session.viewId,
                }),
              ]
            : []),
        ]);
      } catch (error) {
        if (session.active)
          toast.error(error instanceof Error ? error.message : 'Could not save view options');
      } finally {
        session.pending--;
        if (session.active) renderDraft((n) => n + 1);
      }
    });
  }

  return { viewOptions: session.draft as ViewOptions & Record<string, unknown>, patchOptions };
}
