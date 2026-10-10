'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  CellRenderer,
  type FieldLike,
  type RecordLike,
} from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { Button } from '@/components/ui/button';
import { getHexForColor } from '@/lib/color-utils';
import type { Colors } from '@/lib/colors';
import { KANBAN_UNAVAILABLE_CHOICE_ID } from '@/lib/kanban-config';
import { trpc } from '@/lib/trpc/client';

export type LaneSpec = { choiceId: string | null; name: string; color?: string; count?: number };
type Scope = { baseId: string; tableId: string; viewId: string; readOnly: boolean };

function menuKeys(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === 'Tab') {
    close();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    event.currentTarget
      .closest('article')
      ?.querySelector<HTMLButtonElement>('button[aria-haspopup]')
      ?.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  );
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  items[index]?.focus();
}

export function KanbanLane({
  scope,
  lane,
  title,
  targets,
  pending,
  onMove,
  onOpen,
  onVisible,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  scope: Scope;
  lane: LaneSpec;
  title?: FieldLike;
  targets: LaneSpec[];
  pending: Set<string>;
  onMove: (id: string, target: string | null) => void;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
  onVisible: (ids: Set<string> | null) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [pages, setPages] = useState(1);
  const [menu, setMenu] = useState<string | null>(null);
  const queries = trpc.useQueries((query) =>
    Array.from({ length: pages }, (_, page) =>
      query.record.kanbanPage({
        tableId: scope.tableId,
        viewId: scope.viewId,
        choiceId: lane.choiceId,
        offset: page * 50,
        limit: 50,
      }),
    ),
  );
  const records = queries.flatMap((query) => query.data?.records ?? []) as RecordLike[];
  // Offsets can shift under remote edits; never render a duplicate card.
  const unique = [...new Map(records.map((record) => [record.id, record])).values()];
  const ids = JSON.stringify(unique.map((record) => record.id));
  useEffect(() => {
    onVisible(new Set(JSON.parse(ids) as string[]));
    return () => onVisible(null);
  }, [ids, onVisible]);
  const total = queries[0]?.data?.total;
  const loading = queries.some((query) => query.isLoading);
  const error = queries.some((query) => query.isError);
  const canDrop = !scope.readOnly && lane.choiceId !== KANBAN_UNAVAILABLE_CHOICE_ID;
  return (
    <section
      role="region"
      aria-label={lane.name}
      className="min-h-40 w-72 shrink-0 self-start rounded-lg border border-border bg-muted/30 p-3"
      onDragOver={(event) => {
        if (canDrop) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (canDrop) onDrop();
      }}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span
          className="h-2.5 w-2.5 rounded-full bg-muted-foreground"
          style={
            lane.color
              ? { backgroundColor: getHexForColor(lane.color as Colors) ?? undefined }
              : undefined
          }
        />
        {lane.name}
        <span className="ml-auto text-muted-foreground">{lane.count ?? total ?? '…'}</span>
      </h2>
      <div className="space-y-2">
        {unique.map((record) => (
          <article
            key={record.id}
            data-record-id={record.id}
            aria-label={`Record ${record.id}`}
            draggable={!scope.readOnly && !pending.has(record.id)}
            onDragStart={(event) => {
              if (scope.readOnly || pending.has(record.id)) {
                event.preventDefault();
                return;
              }
              onDragStart(record.id);
              event.dataTransfer.setData('text/plain', record.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={onDragEnd}
            className="rounded-md border border-border bg-background p-3 shadow-sm"
          >
            <div className="min-h-6 break-words">
              {title ? (
                <CellRenderer
                  field={title}
                  record={record}
                  users={[]}
                  readOnly
                  onUpsertCell={() => {}}
                />
              ) : (
                <span className="text-sm">{record.id}</span>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              aria-label="Open record details"
              onClick={(event) => onOpen(record.id, event.currentTarget)}
            >
              Open details
            </Button>
            {pending.has(record.id) && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                Saving…
              </p>
            )}
            {!scope.readOnly && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  aria-label="Move record to status"
                  aria-haspopup="menu"
                  aria-expanded={menu === record.id}
                  disabled={pending.has(record.id)}
                  onClick={() => setMenu(menu === record.id ? null : record.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setMenu(record.id);
                    }
                  }}
                >
                  Move to…
                </Button>
                {menu === record.id && (
                  <div
                    role="menu"
                    aria-label="Status destinations"
                    className="rounded border border-border p-1"
                    onKeyDown={(event) => menuKeys(event, () => setMenu(null))}
                  >
                    {targets.map((target, index) => (
                      <button
                        type="button"
                        role="menuitem"
                        autoFocus={index === 0}
                        className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted focus:bg-muted"
                        key={JSON.stringify(target.choiceId)}
                        onClick={() => {
                          setMenu(null);
                          onMove(record.id, target.choiceId);
                        }}
                      >
                        {target.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      {loading && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading cards…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Unable to load cards.{' '}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              for (const query of queries) void query.refetch();
            }}
          >
            Retry
          </Button>
        </p>
      )}
      {!loading && !error && unique.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">No records</p>
      )}
      {!error && total !== undefined && pages * 50 < total && (
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setPages((current) => current + 1)}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
