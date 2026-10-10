'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldLike } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { Button } from '@/components/ui/button';
import { usePresence } from '@/components/realtime/realtime-provider';
import type { SelectOption } from '@/lib/field-types';
import {
  KANBAN_UNAVAILABLE_CHOICE_ID,
  validateKanbanFields,
  type KanbanConfig,
} from '@/lib/kanban-config';
import { parseViewOptionsStrict } from '@/lib/view-ast';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import { moveCard } from './move';
import { BoardSettings } from './board-settings';
import { KanbanLane, type LaneSpec } from './kanban-lane';

type Scope = { baseId: string; tableId: string; viewId: string; readOnly: boolean };

export function KanbanBoard(props: Scope) {
  const views = trpc.view.list.useQuery({ tableId: props.tableId });
  const fields = trpc.field.list.useQuery({ tableId: props.tableId });
  if (views.isLoading || fields.isLoading)
    return (
      <p role="status" className="p-4">
        Loading board…
      </p>
    );
  if (views.isError || fields.isError)
    return (
      <div role="alert" className="p-4">
        Unable to load board.{' '}
        <Button
          onClick={() => {
            void views.refetch();
            void fields.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  const view = views.data?.find((view) => view.id === props.viewId);
  if (view?.type !== 'kanban') return <p className="p-4">Board is unavailable.</p>;
  return (
    <BoardContent
      key={`${props.tableId}:${props.viewId}`}
      {...props}
      options={view.options as Record<string, unknown>}
      fields={(fields.data ?? []) as FieldLike[]}
    />
  );
}

function BoardContent({
  options,
  fields,
  ...scope
}: Scope & { options: Record<string, unknown>; fields: FieldLike[] }) {
  const parsed = parseViewOptionsStrict(options);
  const config = parsed?.kanban;
  let choices: SelectOption[] | null = null;
  let reason = 'Configure a status field for this board.';
  if (config) {
    try {
      choices = validateKanbanFields(config, fields);
    } catch (error) {
      reason = (error as Error).message;
    }
  }
  const [editing, setEditing] = useState(false);
  // Only board-relevant metadata resets pages/pending state. A harmless query
  // refresh retains pages, focus and configuration drafts.
  const title = fields.find((field) => field.id === config?.titleFieldId);
  const signature = JSON.stringify([config, choices, title]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!choices && (
        <p role="status" className="px-4 pt-4">
          {reason}
        </p>
      )}
      {scope.readOnly ? (
        !choices && (
          <p className="p-4 text-sm text-muted-foreground">
            Ask an editor to configure this board.
          </p>
        )
      ) : (
        <div className="p-4">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Configure board
          </Button>
          {(editing || !choices) && (
            <BoardSettings
              key={scope.viewId}
              tableId={scope.tableId}
              viewId={scope.viewId}
              fields={fields}
              options={options}
              onSaved={() => setEditing(false)}
              onEditing={() => setEditing(true)}
            />
          )}
        </div>
      )}
      {choices && config && (
        <ConfiguredBoard
          key={signature}
          {...scope}
          config={config}
          choices={choices}
          title={title}
        />
      )}
    </div>
  );
}

function ConfiguredBoard({
  config,
  choices,
  title,
  ...scope
}: Scope & { config: KanbanConfig; choices: SelectOption[]; title?: FieldLike }) {
  const counts = trpc.record.groupCounts.useQuery({ tableId: scope.tableId, viewId: scope.viewId });
  const utils = trpc.useUtils();
  const upsert = trpc.cell.upsert.useMutation();
  const presence = usePresence(scope.baseId);
  const members = trpc.member.list.useQuery({ baseId: scope.baseId });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  // Refs enforce exclusion synchronously, including drops before React renders.
  const inFlight = useRef(new Set<string>());
  const dragging = useRef<string | null>(null);
  const visible = useRef(new Map<string, Set<string>>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dragging.current = null;
    };
  }, []);
  const allowed = choices.map((choice) => choice.id);
  const known = new Set(allowed);
  const laneCounts = new Map((counts.data?.groups ?? []).map((group) => [group.key, group.count]));
  const unavailable = (counts.data?.groups ?? []).reduce(
    (sum, group) => sum + (group.key !== null && !known.has(group.key) ? group.count : 0),
    0,
  );
  const lanes: LaneSpec[] = [
    ...choices.map((choice) => ({
      choiceId: choice.id,
      name: choice.name,
      color: choice.color,
      count: counts.data ? (laneCounts.get(choice.id) ?? 0) : undefined,
    })),
    {
      choiceId: null,
      name: 'No status',
      count: counts.data ? (laneCounts.get(null) ?? 0) : undefined,
    },
    ...(unavailable
      ? [{ choiceId: KANBAN_UNAVAILABLE_CHOICE_ID, name: 'Unavailable', count: unavailable }]
      : []),
  ];
  async function move(recordId: string, choiceId: string | null) {
    if (scope.readOnly || inFlight.current.has(recordId)) return;
    inFlight.current.add(recordId);
    setPending(new Set(inFlight.current));
    setError('');
    try {
      await moveCard(
        { recordId, fieldId: config.groupFieldId, choiceId, allowed, readOnly: scope.readOnly },
        async (input) => {
          const result = await upsert.mutateAsync(input);
          if (!mounted.current) return;
          const by = result?.overwroteRecentBy;
          if (by?.userId) {
            const name =
              presence.find((user) => user.userId === by.userId)?.userName ??
              members.data?.find((user) => user.userId === by.userId)?.name ??
              by.userId.slice(0, 8);
            toast.info(`Overwrote a recent edit by ${name}`);
          }
        },
      );
      // Committed writes must refresh the original table even after this
      // renderer unmounts. Only local UI feedback is gated by mounted state.
      await Promise.all([
        utils.record.kanbanPage.invalidate({ tableId: scope.tableId }),
        utils.record.groupCounts.invalidate({ tableId: scope.tableId }),
        utils.record.list.invalidate({ tableId: scope.tableId }),
      ]);
    } catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message : 'Unable to move record';
      setError(message);
      toast.error(message);
    } finally {
      inFlight.current.delete(recordId);
      if (mounted.current) setPending(new Set(inFlight.current));
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {counts.isError && (
        <p role="alert" className="px-4 text-sm text-destructive">
          Unable to load board counts. Configure the board or{' '}
          <Button size="sm" variant="ghost" onClick={() => void counts.refetch()}>
            Retry
          </Button>
        </p>
      )}
      <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4" aria-label="Kanban board">
        {lanes.map((lane) => (
          <KanbanLane
            key={JSON.stringify(lane.choiceId)}
            scope={scope}
            lane={lane}
            title={title}
            targets={lanes.filter((target) => target.choiceId !== KANBAN_UNAVAILABLE_CHOICE_ID)}
            pending={pending}
            onMove={(id, target) => void move(id, target)}
            onVisible={(ids) => {
              const key = lane.choiceId ?? '';
              if (ids) visible.current.set(key, ids);
              else visible.current.delete(key);
            }}
            onDragStart={(id) => {
              if (!scope.readOnly && !inFlight.current.has(id)) dragging.current = id;
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
            onDrop={() => {
              const id = dragging.current;
              dragging.current = null;
              if (id && [...visible.current.values()].some((ids) => ids.has(id)))
                void move(id, lane.choiceId);
            }}
          />
        ))}
      </div>
    </>
  );
}
