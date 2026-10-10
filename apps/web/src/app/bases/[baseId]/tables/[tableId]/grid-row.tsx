'use client';

import { memo } from 'react';

import { FieldType } from '@/lib/field-types';
import { cn } from '@/lib/utils';
import {
  CellRenderer,
  EditingCell,
  type FieldLike,
  type RecordLike,
  type UserLike,
} from './cell-renderers';

// Paper & Ink density (redesign spec §4.3): row-height-default 32px.
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 36; // spec header-height 36px
export const ROWNO_COL_WIDTH = 40;
export const TRAILING_COL_WIDTH = 120;
export const DEFAULT_COL_WIDTH = 160;
export const MIN_COL_WIDTH = 60;
export const KEYBOARD_RESIZE_STEP = 16;

export const INLINE_EDIT_TYPES: ReadonlySet<string> = new Set([
  FieldType.Text,
  FieldType.Number,
  FieldType.Date,
]);
// Type-to-edit seeds the inline input with the typed character. Date is
// excluded: <input type=date|datetime-local> discards a seeded single char, so
// "typing over" a date cell would silently drop the keystroke. Enter and
// double-click still open the date editor.
export const TYPE_TO_EDIT_SEED_TYPES: ReadonlySet<string> = new Set([
  FieldType.Text,
  FieldType.Number,
]);
export const EDITABLE_TYPES: ReadonlySet<string> = new Set([
  ...INLINE_EDIT_TYPES,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.User,
  FieldType.Link,
]);

// Cell identity for aria-activedescendant / scrollIntoView targeting. Record and
// field ids are uuids, so the composite is unique across documents.
export function cellDomId(recordId: string, fieldId: string): string {
  return `mp-cell-${recordId}-${fieldId}`;
}

export interface CellHandlers {
  selectCell: (recordId: string, fieldId: string) => void;
  startEdit: (recordId: string, fieldId: string, seed?: string) => void;
  commitCell: (
    recordId: string,
    fieldId: string,
    value: unknown,
    move: 'down' | 'right' | null,
  ) => void;
  cancelEdit: () => void;
  /** Returns the per-cell write-queue promise when available (see grid-editor). */
  upsertCell: (recordId: string, fieldId: string, value: unknown) => unknown;
  toggleRowSelect: (
    recordId: string,
    ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void;
  deleteRecordById: (recordId: string) => void;
}

// memo'd cell wrapper: only the editing cell receives volatile props, so an
// edit re-renders that cell instead of every cell in the row/grid. CellRenderer
// underneath is memo'd too (double layer) for the same reason.
const MemoCell = memo(function MemoCell({
  field,
  rec,
  users,
  baseId,
  readOnly,
  upsert,
}: {
  field: FieldLike;
  rec: RecordLike;
  users: UserLike[];
  baseId: string;
  readOnly: boolean;
  upsert: (recordId: string, fieldId: string, value: unknown) => void;
}) {
  return (
    <CellRenderer
      field={field}
      record={rec}
      users={users}
      baseId={baseId}
      readOnly={readOnly}
      onUpsertCell={upsert}
    />
  );
});

export const GridRow = memo(function GridRow({
  record,
  rowIndex,
  dataRowIndex,
  rowNumber,
  fields,
  widths,
  users,
  baseId,
  readOnly,
  rowSelected,
  selectedFieldId,
  rowTabbable,
  editing,
  start,
  handlers,
}: {
  record: RecordLike;
  /** Position among ALL rendered rows (group headers included), for aria-rowindex. */
  rowIndex: number;
  /** 0-based index into the flattened record list, for keyboard targeting. */
  dataRowIndex: number;
  rowNumber: number;
  fields: FieldLike[];
  widths: Record<string, number>;
  users: UserLike[];
  baseId: string;
  readOnly: boolean;
  rowSelected: boolean;
  selectedFieldId: string | null;
  /** Roving tabindex: only the selected row's controls are tab stops. */
  rowTabbable: boolean;
  editing: { fieldId: string; seed?: string } | null;
  start: number;
  handlers: CellHandlers;
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-selected={rowSelected || undefined}
      className={cn(
        'group absolute left-0 top-0 flex w-full border-b border-border',
        rowSelected && 'bg-primary/5',
      )}
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
    >
      <div
        role="gridcell"
        aria-colindex={1}
        className="relative flex flex-none items-center justify-center border-b-0 text-xs text-muted-foreground"
        style={{ width: ROWNO_COL_WIDTH }}
      >
        <button
          aria-label={`Select row ${rowNumber}`}
          tabIndex={rowTabbable ? 0 : -1}
          className={cn(
            'h-full w-full text-xs',
            rowSelected && 'bg-primary/10 font-semibold text-primary',
          )}
          onClick={(e) => handlers.toggleRowSelect(record.id, e)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {rowNumber}
        </button>
        {!readOnly && (
          // Visible (and tabbable) when the row is selected, not only on
          // hover: keyboard and touch users have no hover, and tabIndex=-1
          // made record deletion unreachable without a mouse.
          <button
            aria-label={`Delete record ${rowNumber}`}
            title="Delete record"
            tabIndex={rowTabbable ? 0 : -1}
            className={cn(
              'absolute right-1 top-1/2 -translate-y-1/2 leading-none text-muted-foreground hover:text-destructive',
              rowTabbable ? 'block' : 'hidden group-hover:block',
            )}
            onClick={(e) => {
              e.stopPropagation();
              handlers.deleteRecordById(record.id);
            }}
          >
            ×
          </button>
        )}
      </div>
      {fields.map((f, ci) => {
        const editingThis = editing?.fieldId === f.id;
        const selectedThis = selectedFieldId === f.id;
        return (
          <div
            key={f.id}
            id={cellDomId(record.id, f.id)}
            role="gridcell"
            data-row={dataRowIndex}
            data-col={ci}
            aria-colindex={ci + 2}
            aria-selected={selectedThis || undefined}
            onClick={() => handlers.selectCell(record.id, f.id)}
            onDoubleClick={() =>
              !readOnly && EDITABLE_TYPES.has(f.type) && handlers.startEdit(record.id, f.id)
            }
            className={cn(
              'relative flex-none overflow-hidden border-l border-border',
              selectedThis && 'ring-2 ring-inset ring-foreground',
            )}
            style={{ width: widths[f.id] ?? DEFAULT_COL_WIDTH }}
          >
            {editingThis ? (
              <EditingCell
                field={f}
                record={record}
                users={users}
                baseId={baseId}
                seed={editing?.seed}
                onCommit={(value, move) => handlers.commitCell(record.id, f.id, value, move)}
                onCancel={handlers.cancelEdit}
                onWrite={(value) => handlers.upsertCell(record.id, f.id, value)}
              />
            ) : (
              <MemoCell
                field={f}
                rec={record}
                users={users}
                baseId={baseId}
                readOnly={readOnly}
                upsert={handlers.upsertCell}
              />
            )}
          </div>
        );
      })}
      {/* Trailing spacer mirrors the header's "+" column: omit it for viewers
          so header and rows stay the same width (the "+" column itself is
          editor-only) and the right border does not break. */}
      {!readOnly && (
        <div className="flex-none border-l border-border" style={{ width: TRAILING_COL_WIDTH }} />
      )}
    </div>
  );
});

export const GroupHeaderRow = memo(function GroupHeaderRow({
  label,
  count,
  rowIndex,
  colCount,
  start,
}: {
  label: string;
  count: number | undefined;
  rowIndex: number;
  colCount: number;
  start: number;
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      className="absolute left-0 top-0 flex w-full border-b border-border bg-muted/30"
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
    >
      <div
        role="gridcell"
        aria-colindex={1}
        aria-colspan={colCount}
        className="flex h-full items-center px-2 text-left text-xs font-medium"
      >
        <span className="truncate">
          {label} <span className="text-muted-foreground">({count ?? 'Count unavailable'})</span>
        </span>
      </div>
    </div>
  );
});
