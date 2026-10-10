'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, History } from 'lucide-react';

import { usePresence } from '@/components/realtime/realtime-provider';
import {
  FieldEditorDialog,
  type FieldEditorTarget,
} from '@/components/field-config/field-editor-dialog';
import { FilterPanel } from '@/components/view-config/filter-panel';
import { SortMenu } from '@/components/view-config/sort-menu';
import { ViewFieldsMenu } from '@/components/view-config/view-fields-menu';
import { ViewTabs } from '@/components/view-config/view-tabs';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { expressionToDisplay } from '@/lib/expression-display';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import type { SortSpec, ViewOptions } from '@/lib/view-ast';
import type { FieldLike, RecordLike } from './cell-renderers';
import { CellHistoryDock } from './cell-history-dock';
import { formatClipboardValue } from './clipboard';
import {
  DEFAULT_COL_WIDTH,
  EDITABLE_TYPES,
  GridRow,
  GroupHeaderRow,
  HEADER_HEIGHT,
  KEYBOARD_RESIZE_STEP,
  MIN_COL_WIDTH,
  ROWNO_COL_WIDTH,
  ROW_HEIGHT,
  TRAILING_COL_WIDTH,
  TYPE_TO_EDIT_SEED_TYPES,
  cellDomId,
  type CellHandlers,
} from './grid-row';
import { nextRowRequest } from './navigation';
import { useGridPaste } from './use-grid-paste';
import { LinkTablesProvider } from './link-cell';
import {
  PAGE_SIZE,
  usePagedRecords,
  type GroupLike,
  type RecordListData,
} from './use-paged-records';

interface ViewLike {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
}

// Field ids whose value decides WHICH rows the view returns (filter condition
// participants, group-by fields) or WHERE they sit (sort keys). A cell edit on
// one of them must refetch record.list — the optimistic patch can only rewrite
// a cell in place; it cannot move a record between groups, drop a
// now-filtered-out row, update totals, or re-order rows. Including sort keys
// means an edit that happens not to change the row's position still pays one
// refetch — over-triggering slightly is the price of correct row order. Walks
// the raw options defensively (iteratively — filter is an arbitrary and/or
// tree) instead of parseViewOptions, which degrades invalid rows to {} and
// would silently drop the field ids.
function collectViewAffectingFieldIds(options: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const group = options.group;
  if (Array.isArray(group)) {
    for (const g of group) {
      const fieldId = (g as { fieldId?: unknown } | null)?.fieldId;
      if (typeof fieldId === 'string') ids.add(fieldId);
    }
  }
  const sort = options.sort;
  if (Array.isArray(sort)) {
    for (const s of sort) {
      const fieldId = (s as { fieldId?: unknown } | null)?.fieldId;
      if (typeof fieldId === 'string') ids.add(fieldId);
    }
  }
  const stack: unknown[] = [options.filter];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (typeof n.fieldId === 'string') ids.add(n.fieldId);
    if (Array.isArray(n.conditions)) stack.push(...n.conditions);
  }
  return ids;
}

interface EditingState {
  recordId: string;
  fieldId: string;
  /** Typed char that opened the editor (type-to-edit); undefined otherwise. */
  seed?: string;
}

// PageUp/PageDown jump, in rows — ~1.5 screens at the default viewport.
const PAGE_JUMP_ROWS = 30;

// Optimistic patch: rewrite exactly one cell of one record inside a record.list
// cache entry, leaving every other object reference untouched so memoized rows
// outside the edited record skip re-rendering.
function patchRecordCell(
  data: RecordListData,
  recordId: string,
  fieldId: string,
  value: unknown,
): RecordListData {
  return {
    ...data,
    groups: data.groups.map((g) =>
      g.records.some((r) => r.id === recordId)
        ? {
            ...g,
            records: g.records.map((r) =>
              r.id === recordId ? { ...r, cells: { ...r.cells, [fieldId]: value } } : r,
            ),
          }
        : g,
    ),
  };
}

export function GridEditor({ baseId, tableId }: { baseId: string; tableId: string }) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const {
    data: fieldsData,
    isLoading: fieldsLoading,
    isError: fieldsError,
  } = trpc.field.list.useQuery({ tableId });
  const {
    data: viewsData,
    isLoading: viewsLoading,
    isError: viewsError,
  } = trpc.view.list.useQuery({ tableId });
  const { data: usersData } = trpc.auth.listUsers.useQuery();
  const { data: myMembership } = trpc.member.me.useQuery({ baseId });
  const { data: tablesData } = trpc.table.list.useQuery({ baseId });
  const presence = usePresence(baseId);
  // While membership is unresolved, render read-only: flashing the editable
  // UI at a viewer invites type-to-edit mutations that the server must then
  // reject. Editors see one extra frame of read-only — harmless.
  const isViewer = myMembership?.role !== 'owner' && myMembership?.role !== 'editor';

  const fields = useMemo(() => (fieldsData ?? []) as FieldLike[], [fieldsData]);
  const views = useMemo(() => (viewsData ?? []) as ViewLike[], [viewsData]);
  const users = useMemo(() => usersData ?? [], [usersData]);
  // Expression columns display `{Field Name}` tokens, never the stored UUIDs.
  const expressionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fields) {
      if (f.type !== FieldType.Expression) continue;
      const expr = (f.options as { expression?: string })?.expression;
      if (expr) m.set(f.id, expressionToDisplay(expr, fields));
    }
    return m;
  }, [fields]);

  // Breadcrumb: the base layout owns the "Workspace ▸ Base" prefix; this page
  // only sets its leaf segment.
  const tableName = tablesData?.find((t) => t.id === tableId)?.name ?? null;
  useBreadcrumbSetter([{ label: tableName ?? 'Table' }]);

  // --- All hooks above/below the loading/error early-returns (Rules of Hooks). ---
  // activeViewId is DERIVED, not set in an effect: deriving makes it correct in
  // the same render the views arrive, so the first record.list query fires with
  // the final viewId. An effect would run one render later, leaving a
  // viewId-less page-1 query in flight that the real query then duplicates.
  // Stale selections (view deleted by someone else) fall back to the first view
  // in the same render the views list updates.
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const activeViewId =
    selectedViewId && views.some((v) => v.id === selectedViewId)
      ? selectedViewId
      : (views[0]?.id ?? null);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  // Memoized: a fresh `{}`/array per render would break memoization downstream.
  const viewOptions = useMemo(() => (activeView?.options ?? {}) as ViewOptions, [activeView]);
  const hiddenFields = useMemo(() => viewOptions.hiddenFields ?? [], [viewOptions]);
  const displayedFields = useMemo(
    () => fields.filter((f) => !hiddenFields.includes(f.id)),
    [fields, hiddenFields],
  );
  const hasGroup = Boolean(viewOptions.group?.length);

  // Latest-value ref: the mutation callbacks below must see the CURRENT view's
  // affected fields without depending on them (that would re-create the
  // mutation and break the memoized cell handlers).
  const viewAffectingFieldIds = useMemo(
    () => collectViewAffectingFieldIds(activeView?.options ?? {}),
    [activeView],
  );
  const viewAffectingFieldIdsRef = useRef(viewAffectingFieldIds);
  viewAffectingFieldIdsRef.current = viewAffectingFieldIds;

  const {
    groups,
    total,
    recordsLoading,
    recordsError,
    trailingPageError,
    retryRecords,
    anyFetching,
    showMore,
  } = usePagedRecords(tableId, activeViewId ?? undefined, !viewsLoading && !viewsError);
  const groupCounts = trpc.record.groupCounts.useQuery(
    { tableId, viewId: activeViewId ?? '' },
    { enabled: Boolean(activeViewId) && !viewsLoading && !viewsError },
  );
  const completeCounts = useMemo(
    () =>
      new Map(
        groupCounts.isError ? [] : (groupCounts.data?.groups.map((g) => [g.key, g.count]) ?? []),
      ),
    [groupCounts.data, groupCounts.isError],
  );
  const flatRows = useMemo(() => groups.flatMap((g) => g.records), [groups]);
  const loadedCount = flatRows.length;
  const rowNumberById = useMemo(() => {
    const m = new Map<string, number>();
    flatRows.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [flatRows]);
  const recordById = useMemo(() => new Map(flatRows.map((r) => [r.id, r] as const)), [flatRows]);

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(
    null,
  );
  const scopeKey = `${tableId}:${activeViewId ?? ''}:${JSON.stringify(viewOptions)}`;
  const paste = useGridPaste({
    tableId,
    scopeKey,
    rows: flatRows,
    fields: displayedFields,
    users,
    selectedCell,
    readOnly: isViewer,
    editing: Boolean(editing),
    total,
    fetching: anyFetching,
    pageError: Boolean(recordsError || trailingPageError),
    showMore,
    allowAppend:
      !viewOptions.filter && !viewOptions.sort?.length && !hasGroup && loadedCount === total,
  });
  const [pendingNavigation, setPendingNavigation] = useState<{
    scopeKey: string;
    targetRow: number;
    fieldId: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FieldEditorTarget | undefined>(undefined);
  const [showFilter, setShowFilter] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthsRef = useRef<Record<string, number>>({});
  // History-dock collapse preference. Loaded in an effect (not the state
  // initializer) so SSR and first client render agree — localStorage is a
  // browser-only source of truth.
  const [dockCollapsed, setDockCollapsed] = useState(false);
  useEffect(() => {
    setDockCollapsed(window.localStorage.getItem('mp-dock-collapsed') === '1');
  }, []);
  function toggleDockCollapsed(next: boolean) {
    setDockCollapsed(next);
    try {
      window.localStorage.setItem('mp-dock-collapsed', next ? '1' : '0');
    } catch {
      // Private mode / storage disabled — the in-memory state still applies.
    }
  }

  // A selected/edited record can vanish under the selection — remote delete,
  // or a refetch that filters it out of the view. A dangling selection breaks
  // keyboard nav (Escape included: its handler never runs past the row
  // lookup) and points aria-activedescendant at a node that no longer
  // exists. Clear it as soon as the record disappears from the loaded set.
  useEffect(() => {
    setSelectedCell((cur) => (cur && !recordById.has(cur.recordId) ? null : cur));
    setEditing((cur) => (cur && !recordById.has(cur.recordId) ? null : cur));
    setSelectedRows((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (recordById.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [recordById]);

  // Latest-value refs for stable callbacks (keyboard handlers, row selection).
  const selectedCellRef = useRef(selectedCell);
  const flatRowsRef = useRef(flatRows);
  const displayedFieldsRef = useRef(displayedFields);
  const recordByIdRef = useRef(recordById);
  useEffect(() => {
    selectedCellRef.current = selectedCell;
    flatRowsRef.current = flatRows;
    displayedFieldsRef.current = displayedFields;
    recordByIdRef.current = recordById;
  });

  // Matches every cached record.list entry of this table (all views/offsets) —
  // react-query filter keys partially deep-match.
  const recordListFilter = useMemo(
    () => ({ queryKey: [['record', 'list'], { input: { tableId } }] }),
    [tableId],
  );

  // react-query's `mutate` is referentially stable — depend on it, not on the
  // mutation object, so the cell callbacks stay stable and memoization holds.
  const upsertCell = trpc.cell.upsert.useMutation({
    onMutate: async ({ recordId, fieldId, value }) => {
      await queryClient.cancelQueries(recordListFilter);
      const snapshots = queryClient.getQueriesData<RecordListData>(recordListFilter);
      queryClient.setQueriesData<RecordListData>(recordListFilter, (prev) =>
        prev ? patchRecordCell(prev, recordId, fieldId, value) : prev,
      );
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      for (const [key, prev] of ctx?.snapshots ?? []) queryClient.setQueryData(key, prev);
      toast.error(err.message);
    },
    onSuccess: (res, vars) => {
      // Reconcile the server-normalized value into the same cell — no refetch.
      void utils.record.groupCounts.invalidate({ tableId });
      // record.list is otherwise deliberately NOT invalidated here: the ws
      // broadcast of this write already excludes this session (server passes
      // exceptUserId), and other sessions invalidate via their own
      // RealtimeProvider, so an invalidate would only cause a redundant
      // full-table round trip.
      const serverValue = res && typeof res === 'object' && 'value' in res ? res.value : '';
      // Dependent expression cells recalculated by the server in the same
      // transaction (B = A*2 changes when A does). The same echo-suppression
      // that skips the refetch would otherwise keep them stale locally
      // forever — patch each one from the server's authoritative outcome.
      const recomputed = (res as { recomputed?: { fieldId: string; value: unknown }[] })
        ?.recomputed;
      queryClient.setQueriesData<RecordListData>(recordListFilter, (prev) => {
        if (!prev) return prev;
        let next = patchRecordCell(prev, vars.recordId, vars.fieldId, serverValue);
        for (const rc of recomputed ?? []) {
          next = patchRecordCell(next, vars.recordId, rc.fieldId, rc.value ?? '');
        }
        return next;
      });
      // ...EXCEPT when the edited field drives the view itself (group-by, a
      // filter condition, or a sort key): regrouping/re-filtering/reordering
      // and totals are computed
      // server-side and no local patch can express them. Checked in onSuccess
      // rather than onMutate on purpose: a failed edit must not pay the
      // refetch, and by success time the write is committed, so the refetch
      // returns the re-evaluated view instead of racing the mutation. A
      // recomputed expression field counts too — it can be a sort key just
      // as well as the edited source field.
      const affected = viewAffectingFieldIdsRef.current;
      if (affected.has(vars.fieldId) || (recomputed ?? []).some((rc) => affected.has(rc.fieldId))) {
        void utils.record.list.invalidate({ tableId });
        void utils.record.groupCounts.invalidate({ tableId });
      }
      // The history dock (when open on this cell) shows a stale list otherwise.
      void utils.history.list.invalidate({
        recordId: vars.recordId,
        fieldId: vars.fieldId,
      });
      // LWW signal from the server: this write replaced a concurrent recent
      // edit. Field is optional — consume defensively until the type lands.
      const by = (res as { overwroteRecentBy?: { userId: string | null } | null } | undefined)
        ?.overwroteRecentBy;
      if (by?.userId) {
        const name =
          presence.find((p) => p.userId === by.userId)?.userName ??
          users.find((u) => u.id === by.userId)?.name ??
          by.userId.slice(0, 8);
        toast.info(`Overwrote a recent edit by ${name}`);
      }
    },
  });
  // Serializes writes per (record, field). The server's advisory lock orders
  // the TRANSACTIONS, not the HTTP responses: two rapid writes to the same
  // cell (multi-select/link write-through toggles) can have their onSuccess
  // patches land out of order, leaving the cache showing a value the server
  // already replaced. Chaining per-cell promises keeps the reconciles
  // ordered; failures still surface through the shared onError above and
  // unblock the queue.
  const upsertMutateAsyncRef = useRef(upsertCell.mutateAsync);
  upsertMutateAsyncRef.current = upsertCell.mutateAsync;
  const cellWriteQueues = useRef(new Map<string, Promise<unknown>>());
  const upsertMutate = useCallback(
    (vars: { recordId: string; fieldId: string; value: unknown }) => {
      const key = `${vars.recordId}:${vars.fieldId}`;
      const prev = cellWriteQueues.current.get(key) ?? Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(() => upsertMutateAsyncRef.current(vars).catch(() => {}));
      cellWriteQueues.current.set(key, next);
      void next.finally(() => {
        if (cellWriteQueues.current.get(key) === next) cellWriteQueues.current.delete(key);
      });
      return next;
    },
    [],
  );
  const createRecord = trpc.record.create.useMutation({
    // No success toast: the record appearing in the grid IS the feedback.
    onSuccess: () => {
      void utils.record.list.invalidate({ tableId });
      void utils.record.groupCounts.invalidate({ tableId });
    },
    onError: (err) => toast.error(err.message),
  });
  const createMutate = createRecord.mutate;
  const deleteRecord = trpc.record.delete.useMutation({
    onSuccess: () => {
      void utils.record.list.invalidate({ tableId });
      void utils.record.groupCounts.invalidate({ tableId });
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutate = deleteRecord.mutate;
  // Which option keys were requested since the last settled commit. View
  // options are replaced wholesale by updateOptions, so onSuccess cannot
  // tell a columnWidth-only commit from a filter change without this.
  const pendingOptionKeysRef = useRef(new Set<string>());
  const updateOptionsMut = trpc.view.updateOptions.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate({ tableId });
      // record.list reads filter/sort/group server-side, so those must
      // refetch. Pure UI options (columnWidth, hiddenFields) must NOT: a
      // 400ms-debounced column resize would otherwise refetch every loaded
      // page of the table on each commit.
      const rowAffecting = ['filter', 'sort', 'group'].some((k) =>
        pendingOptionKeysRef.current.has(k),
      );
      pendingOptionKeysRef.current.clear();
      if (rowAffecting) {
        utils.record.list.invalidate({ tableId });
        utils.record.groupCounts.invalidate({ tableId });
      }
    },
    onError: (err) => {
      pendingOptionKeysRef.current.clear();
      toast.error(err.message);
    },
  });

  // Server-side columnWidth is authoritative ONLY at view switches (and the
  // initial resolve once views load). Within a view, remote columnWidth
  // updates — including the round-trip of our own debounced commit through
  // view.list invalidation — must not overwrite local widths: that reset
  // mid-drag/keyboard-resize snapped columns back to their pre-drag size.
  // The ref remembers which view the current widths belong to.
  const lastWidthSyncViewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastWidthSyncViewIdRef.current === activeViewId) return;
    lastWidthSyncViewIdRef.current = activeViewId;
    const w = (viewOptions.columnWidth as Record<string, number> | undefined) ?? {};
    setWidths(w);
    widthsRef.current = w;
    // viewOptions.columnWidth stays in the deps: on a view switch the effect
    // may run before the new view's options are populated (views query
    // refetch) — re-running on the options landing catches that. The ref
    // guard keeps every same-view re-run inert.
  }, [activeViewId, viewOptions.columnWidth]);

  const gridRef = useRef<HTMLDivElement>(null);
  const widthCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{
    fieldId: string;
    startX: number;
    startW: number;
    lastW: number;
    raf: number | null;
    onMove: (ev: MouseEvent) => void;
    onUp: () => void;
  } | null>(null);

  // A drag or debounced width commit in flight at unmount must not leak its
  // window listeners / timer (e.g. navigating away mid-drag).
  useEffect(
    () => () => {
      const d = dragRef.current;
      if (d) {
        window.removeEventListener('mousemove', d.onMove);
        window.removeEventListener('mouseup', d.onUp);
        if (d.raf != null) cancelAnimationFrame(d.raf);
      }
      if (widthCommitTimerRef.current) clearTimeout(widthCommitTimerRef.current);
    },
    [],
  );

  const groupField = viewOptions.group?.[0]
    ? (fields.find((f) => f.id === viewOptions.group![0]!.fieldId) ?? null)
    : null;
  const groupLabel = useCallback(
    (key: string | null): string => {
      if (key === null) return '(empty)';
      if (groupField?.type === FieldType.SingleSelect) {
        const choices = (groupField.options.choices as SelectOption[]) ?? [];
        return choices.find((c) => c.id === key)?.name ?? key;
      }
      return key;
    },
    [groupField],
  );

  type RowDesc =
    | { kind: 'group'; key: string; label: string; count: number | undefined }
    | { kind: 'record'; record: RecordLike; rowIndex: number };
  const rowDescs = useMemo(() => {
    const out: RowDesc[] = [];
    let idx = 0;
    for (const g of groups as GroupLike[]) {
      if (hasGroup) {
        out.push({
          kind: 'group',
          // '\u0000' cannot occur in a group key produced from cell values
          // (they never contain NUL), so the sentinel can't collide with a
          // real "(empty)"-adjacent key and duplicate a React key.
          key: g.key ?? '\u0000null',
          label: groupLabel(g.key),
          count: completeCounts.get(g.key),
        });
      }
      for (const r of g.records) out.push({ kind: 'record', record: r, rowIndex: idx++ });
    }
    return out;
  }, [groups, hasGroup, groupLabel, completeCounts]);

  // Pin the row being edited: scrolling while an editor is open must not
  // unmount it (that would silently drop the draft).
  const editingRowIdx = useMemo(
    () =>
      editing
        ? rowDescs.findIndex((d) => d.kind === 'record' && d.record.id === editing.recordId)
        : -1,
    [editing, rowDescs],
  );
  const editingRowIdxRef = useRef(-1);
  editingRowIdxRef.current = editingRowIdx;

  const rowVirtualizer = useVirtualizer({
    count: rowDescs.length,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // The sticky header occupies the first HEADER_HEIGHT px of the scroll
    // element. Declaring it makes scrollToIndex offsets pixel-correct instead
    // of relying on the coincidence that item positions in the flow happen to
    // offset by exactly the header height; item rendering subtracts it back
    // (vi.start includes the margin, the rows container sits below the header).
    scrollMargin: HEADER_HEIGHT,
    getItemKey: (i) => {
      const d = rowDescs[i];
      return d ? (d.kind === 'record' ? `r:${d.record.id}` : `g:${d.key}`) : i;
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const pinned = editingRowIdxRef.current;
      if (pinned >= 0 && !indexes.includes(pinned)) indexes.push(pinned);
      return indexes;
    },
  });

  // A different view orders/filters rows differently, and a different table
  // is different data entirely — either way the old scroll position is
  // meaningless and can land mid-table on the new one.
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [tableId, activeViewId]);

  const linkTargetTableIds = useMemo(
    () => [
      ...new Set(
        fields
          .filter((f) => f.type === FieldType.Link)
          .map((f) => f.options.targetTableId)
          .filter((v): v is string => typeof v === 'string'),
      ),
    ],
    [fields],
  );

  // The trailing "+" column exists only for editors — header and rows agree on
  // its absence for viewers, keeping widths, borders and aria-colcount in sync.
  const colCount = displayedFields.length + (isViewer ? 1 : 2);
  const gridWidth = useMemo(
    () =>
      ROWNO_COL_WIDTH +
      (isViewer ? 0 : TRAILING_COL_WIDTH) +
      displayedFields.reduce((s, f) => s + (widths[f.id] ?? DEFAULT_COL_WIDTH), 0),
    [displayedFields, widths, isViewer],
  );

  // --- stable cell/row handlers (keep GridRow memoization effective) ---
  const selectCell = useCallback((recordId: string, fieldId: string) => {
    setSelectedCell({ recordId, fieldId });
    gridRef.current?.focus({ preventScroll: true });
  }, []);
  const startEdit = useCallback((recordId: string, fieldId: string, seed?: string) => {
    setSelectedCell({ recordId, fieldId });
    setEditing({ recordId, fieldId, seed });
  }, []);
  const moveTo = useCallback(
    (r: number, c: number) => {
      const rec = flatRowsRef.current[r];
      const f = displayedFieldsRef.current[c];
      if (!rec || !f) return;
      // Bring the row into the virtual window first; the selectedCell effect
      // below then aligns the exact cell (mainly horizontal).
      const virtualIndex = rowDescs.findIndex((d) => d.kind === 'record' && d.record.id === rec.id);
      rowVirtualizer.scrollToIndex(virtualIndex, { align: 'auto' });
      setSelectedCell({ recordId: rec.id, fieldId: f.id });
    },
    [rowVirtualizer, rowDescs],
  );
  function navigate(targetRow: number, column: number) {
    const fieldId = displayedFields[column]?.id;
    if (!fieldId) return;
    const request = nextRowRequest({
      targetRow,
      loaded: loadedCount,
      total,
      fetching: anyFetching,
    });
    if (request.kind === 'select') {
      setPendingNavigation(null);
      moveTo(request.row, column);
    } else {
      setPendingNavigation({ scopeKey, targetRow: Math.min(targetRow, total - 1), fieldId });
      if (request.kind === 'load' && !trailingPageError) showMore();
    }
  }
  useEffect(() => {
    if (!pendingNavigation) return;
    if (pendingNavigation.scopeKey !== scopeKey || editing) {
      setPendingNavigation(null);
      return;
    }
    const request = nextRowRequest({
      targetRow: pendingNavigation.targetRow,
      loaded: loadedCount,
      total,
      fetching: anyFetching,
    });
    if (request.kind === 'select') {
      moveTo(
        request.row,
        displayedFields.findIndex((f) => f.id === pendingNavigation.fieldId),
      );
      setPendingNavigation(null);
    } else if (request.kind === 'load' && !trailingPageError) showMore();
  }, [
    pendingNavigation,
    scopeKey,
    editing,
    loadedCount,
    total,
    anyFetching,
    trailingPageError,
    showMore,
    displayedFields,
    moveTo,
  ]);
  const commitCell = useCallback(
    (recordId: string, fieldId: string, value: unknown, move: 'down' | 'right' | null) => {
      setEditing(null);
      // Editors unmount on commit and drop focus on <body> — park it on the
      // grid so arrow keys keep working.
      gridRef.current?.focus({ preventScroll: true });
      const cur = recordByIdRef.current.get(recordId)?.cells[fieldId];
      const curEmpty = cur == null || cur === '';
      const nextEmpty = value == null || value === '';
      // The server appends a history row on EVERY upsert — skip no-op commits.
      if (!(curEmpty && nextEmpty) && cur !== value) {
        upsertMutate({ recordId, fieldId, value });
      }
      const sc = selectedCellRef.current;
      if (sc && move) {
        const r = flatRowsRef.current.findIndex((x) => x.id === sc.recordId);
        const c = displayedFieldsRef.current.findIndex((f) => f.id === sc.fieldId);
        const lastR = flatRowsRef.current.length - 1;
        const lastC = displayedFieldsRef.current.length - 1;
        if (r >= 0 && c >= 0) {
          if (move === 'down') moveTo(Math.min(r + 1, lastR), c);
          else moveTo(r, Math.min(c + 1, lastC));
        }
      }
    },
    [upsertMutate, moveTo],
  );
  const cancelEdit = useCallback(() => {
    setEditing(null);
    gridRef.current?.focus({ preventScroll: true });
  }, []);
  const upsertCellHandler = useCallback(
    (recordId: string, fieldId: string, value: unknown) => {
      // Returns the per-cell queue promise so direct-write callers (attachment
      // upload) can await cache reconciliation before their next write.
      return upsertMutate({ recordId, fieldId, value });
    },
    [upsertMutate],
  );
  const toggleRowSelect = useCallback(
    (recordId: string, ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      gridRef.current?.focus({ preventScroll: true });
      setSelectedRows((prev) => {
        const next = new Set(prev);
        const anchor = selectedCellRef.current;
        const rows = flatRowsRef.current;
        if (ev.shiftKey && anchor) {
          // Range select: from the selected cell's row to this one.
          const start = rows.findIndex((r) => r.id === anchor.recordId);
          const end = rows.findIndex((r) => r.id === recordId);
          if (start >= 0 && end >= 0) {
            const [lo, hi] = start < end ? [start, end] : [end, start];
            for (let j = lo; j <= hi; j++) next.add(rows[j]!.id);
            return next;
          }
        }
        if (ev.metaKey || ev.ctrlKey) {
          if (next.has(recordId)) next.delete(recordId);
          else next.add(recordId);
          return next;
        }
        next.clear();
        next.add(recordId);
        return next;
      });
    },
    [],
  );
  const deleteRecordById = useCallback(
    (recordId: string) => {
      // Snapshot for the Undo toast. Restoration is best-effort: the record
      // comes back with a NEW id (lands at the end) and its cell history
      // rows are gone with the original — but the data itself returns.
      const snapshot = recordByIdRef.current.get(recordId);
      deleteMutate({ id: recordId, tableId });
      if (snapshot) {
        toast.success('Record deleted', {
          label: 'Undo',
          onClick: () => {
            createMutate(
              { tableId },
              {
                onSuccess: (row) => {
                  for (const [fieldId, value] of Object.entries(snapshot.cells)) {
                    if (value != null && value !== '') {
                      upsertMutate({ recordId: row.id, fieldId, value });
                    }
                  }
                },
              },
            );
          },
        });
      }
    },
    [deleteMutate, tableId, createMutate, upsertMutate],
  );
  const handlers = useMemo<CellHandlers>(
    () => ({
      selectCell,
      startEdit,
      commitCell,
      cancelEdit,
      upsertCell: upsertCellHandler,
      toggleRowSelect,
      deleteRecordById,
    }),
    [
      selectCell,
      startEdit,
      commitCell,
      cancelEdit,
      upsertCellHandler,
      toggleRowSelect,
      deleteRecordById,
    ],
  );

  // Keyboard nav can land on a row outside the virtual window: scrollToIndex
  // mounts it a frame later, so align in a second rAF when the cell exists.
  useEffect(() => {
    if (!selectedCell) return;
    const id = cellDomId(selectedCell.recordId, selectedCell.fieldId);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        gridRef.current
          ?.querySelector(`[id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [selectedCell]);

  if (fieldsLoading || viewsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3">
          <div className="h-8 w-96 animate-pulse rounded bg-muted" />
          <div className="h-64 w-96 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (fieldsError || viewsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
        <div>
          {fieldsError ? 'Failed to load fields.' : 'Failed to load views.'} Please try again.
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void utils.field.list.invalidate({ tableId });
            void utils.view.list.invalidate({ tableId });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (recordsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
        <div>Failed to load records. {recordsError.message}</div>
        <Button size="sm" variant="outline" onClick={() => retryRecords()}>
          Retry
        </Button>
      </div>
    );
  }

  if (recordsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3">
          <div className="h-8 w-96 animate-pulse rounded bg-muted" />
          <div className="h-64 w-96 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  function patchOptions(patch: Partial<ViewOptions>) {
    if (!activeView) return;
    for (const k of Object.keys(patch)) pendingOptionKeysRef.current.add(k);
    const next = { ...(activeView.options as ViewOptions), ...patch } as Record<string, unknown>;
    updateOptionsMut.mutate({ id: activeView.id, options: next });
  }

  // Mutate the width ref OUTSIDE the state updater — updater functions must
  // stay pure.
  function applyLocalWidth(fieldId: string, w: number) {
    widthsRef.current = { ...widthsRef.current, [fieldId]: w };
    setWidths(widthsRef.current);
  }
  function commitWidthsNow() {
    if (widthCommitTimerRef.current) {
      clearTimeout(widthCommitTimerRef.current);
      widthCommitTimerRef.current = null;
    }
    patchOptions({ columnWidth: widthsRef.current });
  }
  function scheduleWidthCommit() {
    if (widthCommitTimerRef.current) clearTimeout(widthCommitTimerRef.current);
    widthCommitTimerRef.current = setTimeout(() => {
      widthCommitTimerRef.current = null;
      patchOptions({ columnWidth: widthsRef.current });
    }, 400);
  }

  function onResizeKeyDown(e: ReactKeyboardEvent, fieldId: string) {
    // The handle owns its keys — Tab must move focus, not the grid selection.
    e.stopPropagation();
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = widthsRef.current[fieldId] ?? DEFAULT_COL_WIDTH;
    const next = Math.max(
      MIN_COL_WIDTH,
      cur + (e.key === 'ArrowRight' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP),
    );
    applyLocalWidth(fieldId, next);
    scheduleWidthCommit();
  }

  function startResize(e: ReactMouseEvent, fieldId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const d = {
      fieldId,
      startX: e.clientX,
      startW: widthsRef.current[fieldId] ?? DEFAULT_COL_WIDTH,
      lastW: 0,
      raf: null as number | null,
      onMove: (_ev: MouseEvent) => {},
      onUp: () => {},
    };
    d.lastW = d.startW;
    d.onMove = (ev: MouseEvent) => {
      const nextW = Math.max(MIN_COL_WIDTH, d.startW + (ev.clientX - d.startX));
      if (nextW === d.lastW) return;
      d.lastW = nextW;
      // One width update per frame — raw mousemove would re-render per event.
      if (d.raf != null) return;
      d.raf = requestAnimationFrame(() => {
        d.raf = null;
        applyLocalWidth(d.fieldId, d.lastW);
      });
    };
    d.onUp = () => {
      window.removeEventListener('mousemove', d.onMove);
      window.removeEventListener('mouseup', d.onUp);
      if (d.raf != null) cancelAnimationFrame(d.raf);
      dragRef.current = null;
      commitWidthsNow();
    };
    dragRef.current = d;
    window.addEventListener('mousemove', d.onMove);
    window.addEventListener('mouseup', d.onUp);
  }

  function onGridKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // IME composition: keys delivered while an input method is composing are
    // candidate-selection keystrokes (Enter confirms a 词), never grid
    // commands — Enter/Tab/Space/type-to-edit must all stay inert.
    if (e.nativeEvent.isComposing) return;
    // While an editor is open it owns the keyboard; anything that still reaches
    // the grid is a leak we deliberately ignore.
    if (editing) return;
    if (!selectedCell) return;
    const r = flatRows.findIndex((x) => x.id === selectedCell.recordId);
    const c = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
    if (r < 0 || c < 0) return;
    const field = displayedFields[c]!;
    const rec = flatRows[r]!;
    const lastR = flatRows.length - 1;
    const lastC = displayedFields.length - 1;
    const currentValue = rec.cells[selectedCell.fieldId];

    // Type-to-edit (Airtable/Excel convention): a printable char without
    // modifiers starts an edit seeded with itself on inline fields, or opens
    // the picker editor.
    const tryTypeToEdit = (): boolean => {
      if (
        isViewer ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.key.length !== 1 ||
        !EDITABLE_TYPES.has(field.type)
      ) {
        return false;
      }
      e.preventDefault();
      // Date is intentionally not seedable (see TYPE_TO_EDIT_SEED_TYPES) — it
      // still opens the picker editor via type-to-edit, just unseeded.
      const seed = TYPE_TO_EDIT_SEED_TYPES.has(field.type) ? e.key : undefined;
      startEdit(selectedCell.recordId, selectedCell.fieldId, seed);
      return true;
    };

    // Clipboard shortcuts first — plain 'c'/'v' must still fall through to
    // type-to-edit below.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      // Type-aware serialization (arrays as a|b, objects as JSON) and a caught
      // promise — a denied clipboard permission must not become an unhandled
      // rejection.
      navigator.clipboard.writeText(formatClipboardValue(currentValue)).catch(() => {
        // Clipboard permission denied / unavailable — nothing to copy.
      });
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveTo(e.ctrlKey ? 0 : Math.max(r - 1, 0), c);
        break;
      case 'ArrowDown':
        e.preventDefault();
        navigate(e.ctrlKey ? lastR : r + 1, c);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(r, e.ctrlKey ? 0 : Math.max(c - 1, 0));
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveTo(r, e.ctrlKey ? lastC : Math.min(c + 1, lastC));
        break;
      case 'Home':
        e.preventDefault();
        moveTo(e.ctrlKey ? 0 : r, 0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(e.ctrlKey ? lastR : r, lastC);
        break;
      case 'PageUp':
        e.preventDefault();
        moveTo(Math.max(r - PAGE_JUMP_ROWS, 0), c);
        break;
      case 'PageDown':
        e.preventDefault();
        navigate(r + PAGE_JUMP_ROWS, c);
        break;
      case 'Enter':
        e.preventDefault();
        if (isViewer) break;
        if (field.type === FieldType.Boolean) {
          upsertMutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value: !currentValue,
          });
        } else if (EDITABLE_TYPES.has(field.type)) {
          startEdit(selectedCell.recordId, selectedCell.fieldId);
        }
        break;
      case ' ':
        if (field.type === FieldType.Boolean && !isViewer) {
          e.preventDefault();
          upsertMutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value: !currentValue,
          });
          break;
        }
        // On non-editable columns Space must not scroll the grid container —
        // the grid owns the key even when it has no action for it.
        if (!tryTypeToEdit()) e.preventDefault();
        break;
      case 'Tab': {
        e.preventDefault();
        const nc = c + (e.shiftKey ? -1 : 1);
        if (nc < 0) moveTo(Math.max(r - 1, 0), lastC);
        else if (nc > lastC) navigate(r + 1, 0);
        else moveTo(r, nc);
        break;
      }
      case 'Escape':
        e.preventDefault();
        paste.cancel();
        setPendingNavigation(null);
        setSelectedCell(null);
        setSelectedRows(new Set());
        break;
      case 'Delete':
      case 'Backspace': {
        if (!isViewer) {
          e.preventDefault();
          const cleared = currentValue;
          upsertMutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value: '',
          });
          if (cleared != null && cleared !== '') {
            toast.info('Cell cleared', {
              label: 'Undo',
              onClick: () =>
                upsertMutate({
                  recordId: selectedCell.recordId,
                  fieldId: selectedCell.fieldId,
                  value: cleared,
                }),
            });
          }
        }
        break;
      }
      default:
        tryTypeToEdit();
        break;
    }
  }

  function openCreateField() {
    setEditTarget(undefined);
    setDialogOpen(true);
  }
  function openEditField(f: FieldLike) {
    setEditTarget({ id: f.id, name: f.name, type: f.type, options: f.options });
    setDialogOpen(true);
  }
  // Header click cycles the column's sort: none → asc → desc → none, keeping
  // any other sort keys in place (grid convention; field editing moved to
  // double-click).
  function toggleSort(fieldId: string) {
    const cur = (viewOptions.sort ?? []) as SortSpec[];
    const existing = cur.find((s) => s.fieldId === fieldId);
    let next: SortSpec[];
    if (!existing) next = [...cur, { fieldId, direction: 'asc' }];
    else if (existing.direction === 'asc')
      next = cur.map((s) => (s.fieldId === fieldId ? { ...s, direction: 'desc' as const } : s));
    else next = cur.filter((s) => s.fieldId !== fieldId);
    patchOptions({ sort: next });
  }
  // Explicit-direction variants + clear, for the column header menu.
  function setSortDir(fieldId: string, dir: 'asc' | 'desc') {
    const cur = (viewOptions.sort ?? []) as SortSpec[];
    const existing = cur.find((s) => s.fieldId === fieldId);
    const next = existing
      ? cur.map((s) => (s.fieldId === fieldId ? { ...s, direction: dir } : s))
      : [...cur, { fieldId, direction: dir }];
    patchOptions({ sort: next });
  }
  function clearSort(fieldId: string) {
    const next = ((viewOptions.sort ?? []) as SortSpec[]).filter((s) => s.fieldId !== fieldId);
    patchOptions({ sort: next.length > 0 ? next : undefined });
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    // Toolbar fixed, table body is its own scroll region (no nested page scroll,
    // header stays sticky over the virtualized rows).
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <ViewTabs
        tableId={tableId}
        views={views}
        activeViewId={activeViewId}
        onSelect={setSelectedViewId}
        readOnly={isViewer}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">{activeView?.name ?? 'Grid'}</h1>
        {!isViewer && (
          <Button onClick={openCreateField} size="sm" className="h-7 rounded-md">
            + field
          </Button>
        )}
      </div>

      <p role="status" className="text-xs text-muted-foreground">
        {groupCounts.isError
          ? 'Count unavailable'
          : groupCounts.data
            ? `${loadedCount} / ${groupCounts.data.total} records`
            : 'Counting records…'}
      </p>
      {viewOptions.group && viewOptions.group.length > 1 && (
        <p className="text-xs text-muted-foreground">Only the first grouping field is used.</p>
      )}
      {!isViewer && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={
              showFilter || (viewOptions.filter?.conditions?.length ?? 0) > 0
                ? 'default'
                : 'outline'
            }
            size="sm"
            className="h-7 rounded-md"
            onClick={() => setShowFilter((s) => !s)}
            aria-pressed={showFilter}
          >
            Filter
            {(viewOptions.filter?.conditions?.length ?? 0) > 0
              ? ` (${viewOptions.filter!.conditions.length})`
              : ''}
          </Button>
          <SortMenu
            fields={fields}
            sort={viewOptions.sort}
            onChange={(s) => patchOptions({ sort: s })}
          />
          <ViewFieldsMenu
            tableId={tableId}
            readOnly={isViewer}
            fields={fields}
            hiddenFields={hiddenFields}
            onChange={(ids) => patchOptions({ hiddenFields: ids })}
          />
          <Select
            value={viewOptions.group?.[0]?.fieldId ?? '__none'}
            onValueChange={(v) => {
              if (!v) return;
              patchOptions({ group: v === '__none' ? undefined : [{ fieldId: v }] });
            }}
          >
            <SelectTrigger className="h-7 w-40 rounded-md border-border text-sm">
              {viewOptions.group?.[0]
                ? (fields.find((f) => f.id === viewOptions.group?.[0]?.fieldId)?.name ?? 'Group')
                : 'No grouping'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No grouping</SelectItem>
              {fields.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showFilter && (
        <FilterPanel
          fields={fields}
          filter={viewOptions.filter}
          onChange={(f) => patchOptions({ filter: f })}
        />
      )}

      <LinkTablesProvider tableIds={linkTargetTableIds}>
        {trailingPageError && (
          <div className="flex flex-none items-center gap-2 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive">
            <span className="min-w-0 flex-1 truncate">
              Failed to load more records. {trailingPageError.message}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-md px-2 text-xs"
              onClick={() => trailingPageError.retry()}
            >
              Retry
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-2">
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${activeView?.name ?? 'Grid'} table`}
            aria-rowcount={total + 1 + (hasGroup ? groups.length : 0)}
            aria-colcount={colCount}
            aria-activedescendant={
              selectedCell ? cellDomId(selectedCell.recordId, selectedCell.fieldId) : undefined
            }
            tabIndex={0}
            onKeyDown={onGridKeyDown}
            onPaste={paste.onPaste}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedCell(null);
                setSelectedRows(new Set());
              }
            }}
            // scroll-padding keeps native scrollIntoView(block:'nearest') from
            // aligning the selected cell under the sticky header.
            style={{ scrollPaddingTop: HEADER_HEIGHT }}
            className="min-h-0 flex-1 overflow-auto rounded-md border border-border outline-none"
          >
            <div style={{ width: gridWidth, minWidth: '100%' }}>
              <div className="sticky top-0 z-10 bg-muted">
                <div role="row" className="flex" style={{ height: HEADER_HEIGHT }}>
                  <div
                    role="columnheader"
                    aria-colindex={1}
                    className="flex-none border-b border-border"
                    style={{ width: ROWNO_COL_WIDTH }}
                  />
                  {displayedFields.map((f, ci) => {
                    const w = widths[f.id] ?? DEFAULT_COL_WIDTH;
                    const sort = viewOptions.sort?.find((s) => s.fieldId === f.id);
                    const exprLabel = expressionLabels.get(f.id);
                    // Roving tabindex: exactly ONE resize handle is in the Tab
                    // order (the selected column's, else the first). Without
                    // this every column's handle is a tab stop — 50 columns
                    // means 50 stops before the next control.
                    const rovingHandle = !selectedCell
                      ? ci === 0
                      : selectedCell.fieldId === f.id ||
                        (displayedFields.every((x) => x.id !== selectedCell.fieldId) && ci === 0);
                    return (
                      <div
                        key={f.id}
                        role="columnheader"
                        aria-colindex={ci + 2}
                        aria-sort={
                          sort
                            ? sort.direction === 'desc'
                              ? 'descending'
                              : 'ascending'
                            : undefined
                        }
                        className="group/header relative flex-none border-b border-l border-border p-0"
                        style={{ width: w }}
                      >
                        <button
                          className="block h-full w-full px-2.5 pt-1 text-left"
                          onClick={() => !isViewer && toggleSort(f.id)}
                          onDoubleClick={() => !isViewer && openEditField(f)}
                          title={
                            isViewer
                              ? `${f.name}${exprLabel ? ` (${exprLabel})` : ''}`
                              : `${f.name}${exprLabel ? ` (${exprLabel})` : ''} — click to sort, double-click to edit field`
                          }
                        >
                          <div className="flex items-center text-xs font-medium text-foreground">
                            <span className="truncate">{f.name}</span>
                            {sort && (
                              <span className="ml-1 text-muted-foreground">
                                {sort.direction === 'desc' ? 'Z↓' : 'A↓'}
                              </span>
                            )}
                          </div>
                          {f.type === 'expression' ? (
                            <div className="flex min-w-0 items-center gap-1 pb-1">
                              <span className="min-w-0 truncate rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                                {exprLabel || 'expr'}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                expression
                              </span>
                            </div>
                          ) : (
                            <div className="pb-1 font-mono text-[10px] text-muted-foreground">
                              {f.type}
                            </div>
                          )}
                        </button>
                        {/* Column options menu: the discoverable path to sort
                            and edit (click-to-sort and double-click-to-edit
                            remain as shortcuts). */}
                        {!isViewer && (
                          <Popover>
                            <PopoverTrigger
                              className="absolute right-2.5 top-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover/header:flex focus-visible:flex"
                              aria-label={`Options for ${f.name}`}
                              title="Column options"
                            >
                              <ChevronDown className="size-3.5" />
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-44 p-1">
                              <button
                                type="button"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                onClick={() => setSortDir(f.id, 'asc')}
                              >
                                Sort A → Z
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                onClick={() => setSortDir(f.id, 'desc')}
                              >
                                Sort Z → A
                              </button>
                              {sort && (
                                <button
                                  type="button"
                                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                  onClick={() => clearSort(f.id)}
                                >
                                  Clear sort
                                </button>
                              )}
                              <div className="my-1 border-t border-border" />
                              <button
                                type="button"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                onClick={() => openEditField(f)}
                              >
                                Edit field
                              </button>
                            </PopoverContent>
                          </Popover>
                        )}
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${f.name}`}
                          title="Drag to resize · ←/→ keys adjust"
                          tabIndex={rovingHandle ? 0 : -1}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                          onMouseDown={(e) => startResize(e, f.id)}
                          onKeyDown={(e) => onResizeKeyDown(e, f.id)}
                        />
                      </div>
                    );
                  })}
                  {!isViewer && (
                    <div
                      role="columnheader"
                      aria-colindex={displayedFields.length + 2}
                      className="flex-none border-b border-l border-border"
                      style={{ width: TRAILING_COL_WIDTH }}
                    >
                      <button
                        className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                        onClick={openCreateField}
                        title="Add field"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
                {virtualItems.map((vi) => {
                  const d = rowDescs[vi.index]!;
                  return d.kind === 'group' ? (
                    <GroupHeaderRow
                      key={vi.key}
                      label={d.label}
                      count={d.count}
                      rowIndex={vi.index}
                      colCount={colCount}
                      start={vi.start - HEADER_HEIGHT}
                    />
                  ) : (
                    <GridRow
                      key={vi.key}
                      record={d.record}
                      rowIndex={vi.index}
                      dataRowIndex={d.rowIndex}
                      rowNumber={d.rowIndex + 1}
                      fields={displayedFields}
                      widths={widths}
                      users={users}
                      baseId={baseId}
                      readOnly={isViewer}
                      rowSelected={selectedRows.has(d.record.id)}
                      selectedFieldId={
                        selectedCell?.recordId === d.record.id ? selectedCell.fieldId : null
                      }
                      rowTabbable={selectedCell?.recordId === d.record.id}
                      editing={
                        editing?.recordId === d.record.id
                          ? { fieldId: editing.fieldId, seed: editing.seed }
                          : null
                      }
                      // vi.start includes scrollMargin (the sticky header) —
                      // the rows container already sits below the header, so
                      // subtract it back for positioning.
                      start={vi.start - HEADER_HEIGHT}
                      handlers={handlers}
                    />
                  );
                })}
              </div>

              {loadedCount === 0 && (
                <div className="flex h-16 flex-col items-center justify-center gap-1.5 text-sm text-muted-foreground">
                  {anyFetching ? (
                    'Loading…'
                  ) : (viewOptions.filter?.conditions?.length ?? 0) > 0 ? (
                    <>
                      <span>No records match your filters.</span>
                      <button
                        type="button"
                        className="text-xs text-foreground underline underline-offset-2 hover:opacity-80"
                        onClick={() => patchOptions({ filter: undefined })}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    'No records.'
                  )}
                </div>
              )}

              <div className="flex items-stretch">
                {!isViewer && (
                  <button
                    className="flex flex-1 items-center justify-center gap-1 border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
                    onClick={() => createMutate({ tableId })}
                    disabled={createRecord.isPending}
                  >
                    + new record
                  </button>
                )}
                {loadedCount < total && (
                  <button
                    className="border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
                    onClick={() => showMore()}
                    disabled={anyFetching}
                  >
                    Show more — {loadedCount} of {total}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* History dock is a sibling panel — it can never overlay the cell
              being edited — and steps aside entirely while editing. The
              collapsed rail keeps the grid's width: the dock squeezing it by
              240px was the #1 density complaint (UX audit 4.4). */}
          {selectedCell && !editing && dockCollapsed ? (
            <div className="flex h-full w-9 flex-none flex-col border-l border-border">
              <button
                onClick={() => toggleDockCollapsed(false)}
                aria-label="Show cell history"
                title="Cell history"
                className="flex h-9 w-full items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <History className="size-4" />
              </button>
            </div>
          ) : selectedCell && !editing ? (
            (() => {
              const rowNumber = rowNumberById.get(selectedCell.recordId) ?? 0;
              const field = displayedFields.find((f) => f.id === selectedCell.fieldId);
              const record = recordById.get(selectedCell.recordId);
              if (!field || !record) return null;
              return (
                <CellHistoryDock
                  cell={selectedCell}
                  fieldName={field.name}
                  rowNumber={rowNumber}
                  currentValue={record.cells[selectedCell.fieldId]}
                  onRestore={(value) =>
                    upsertMutate({
                      recordId: selectedCell.recordId,
                      fieldId: selectedCell.fieldId,
                      value,
                    })
                  }
                  onClose={() => setSelectedCell(null)}
                  onCollapse={() => toggleDockCollapsed(true)}
                />
              );
            })()
          ) : null}
        </div>
      </LinkTablesProvider>

      {loadedCount >= total && total > PAGE_SIZE && (
        <div className="pt-1 text-xs text-muted-foreground">Showing all {total} records.</div>
      )}

      {paste.dialog}
      <FieldEditorDialog
        open={dialogOpen && !isViewer}
        onOpenChange={setDialogOpen}
        tableId={tableId}
        field={editTarget}
      />
    </div>
  );
}
