// View options AST (Q7b). Structural types + the zod schemas that guard the
// mutation boundary (routers/view.updateOptions) and tolerate legacy rows.

import { z } from 'zod';

// Operators compileFilter knows how to compile — anything else is rejected at
// write time instead of being silently dropped at query time.
export const FILTER_OPERATORS = [
  'equals',
  'ne',
  'contains',
  'startsWith',
  'gt',
  'lt',
  'gte',
  'lte',
  'is',
  'before',
  'after',
  'empty',
  'notEmpty',
] as const;

// View shapes the product can actually render today (ADR-0001 Phase 1; Form /
// Kanban / Gallery join this list when they ship).
export const VIEW_TYPES = ['grid'] as const;

// DoS guards for untrusted view options (see review item 4b).
const MAX_FILTER_DEPTH = 10;
const MAX_FILTER_NODES = 50;
const MAX_OPERAND_LENGTH = 1000;
const MAX_SORT_ENTRIES = 20;
const MAX_GROUP_ENTRIES = 20;
const MAX_HIDDEN_FIELDS = 200;
const MAX_OPTIONS_BYTES = 64 * 1024;

const FILTER_OPERATOR_SET = new Set<string>(FILTER_OPERATORS);

export type FilterOperator = string;

export interface FilterCondition {
  fieldId: string;
  operator: FilterOperator;
  operand?: unknown;
}

export interface FilterGroup {
  op: 'and' | 'or';
  conditions: FilterNode[];
}

export type FilterNode = FilterGroup | FilterCondition;

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (
    typeof (node as { op?: unknown }).op === 'string' &&
    Array.isArray((node as { conditions?: unknown }).conditions)
  );
}

export interface SortSpec {
  fieldId: string;
  direction: 'asc' | 'desc';
}

export interface GroupSpec {
  fieldId: string;
}

export interface ViewOptions {
  // NOTE: the DECLARED type says group, but the write gate (checkFilterNode)
  // also accepts a bare condition as the filter root — at runtime this can be
  // either. Consumers that walk the tree must go through isFilterGroup /
  // FilterNode-aware helpers (compileFilter, pruneFilterTree), never assume
  // `.conditions` exists.
  filter?: FilterGroup;
  sort?: SortSpec[];
  group?: GroupSpec[];
  hiddenFields?: string[];
  columnWidth?: Record<string, number>;
}

export const EMPTY_VIEW_OPTIONS: ViewOptions = {};

// Iterative filter walker (explicit stack): a hostile deeply-nested payload
// must be rejected, not blow the stack during (zod or manual) recursion.
function checkFilterNode(raw: unknown, ctx: z.RefinementCtx): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: raw, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (++nodes > MAX_FILTER_NODES) {
      ctx.addIssue({ code: 'custom', message: `Filter exceeds ${MAX_FILTER_NODES} conditions` });
      return;
    }
    if (depth > MAX_FILTER_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        message: `Filter nesting exceeds ${MAX_FILTER_DEPTH} levels`,
      });
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      ctx.addIssue({ code: 'custom', message: 'Filter node must be an object' });
      return;
    }
    const n = node as Record<string, unknown>;
    const hasOp = 'op' in n;
    const hasConditions = 'conditions' in n;
    if (hasOp || hasConditions) {
      // Group node — mirror isFilterGroup's shape detection.
      if (n.op !== 'and' && n.op !== 'or') {
        ctx.addIssue({ code: 'custom', message: 'Filter group op must be "and" or "or"' });
        return;
      }
      if (!Array.isArray(n.conditions)) {
        ctx.addIssue({ code: 'custom', message: 'Filter group conditions must be an array' });
        return;
      }
      for (const child of n.conditions) {
        stack.push({ node: child, depth: depth + 1 });
      }
      continue;
    }
    // Condition node.
    if (typeof n.fieldId !== 'string' || n.fieldId.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Filter condition requires a fieldId' });
      return;
    }
    if (typeof n.operator !== 'string' || !FILTER_OPERATOR_SET.has(n.operator)) {
      ctx.addIssue({
        code: 'custom',
        message: `Unsupported filter operator: ${String(n.operator)}`,
      });
      return;
    }
    const operand = n.operand;
    if (operand !== undefined) {
      const scalar =
        operand === null ||
        typeof operand === 'boolean' ||
        typeof operand === 'number' ||
        (typeof operand === 'string' && operand.length <= MAX_OPERAND_LENGTH);
      if (!scalar) {
        ctx.addIssue({
          code: 'custom',
          message: `Filter operand must be a scalar string (max ${MAX_OPERAND_LENGTH} chars), number, boolean or null`,
        });
        return;
      }
    }
  }
}

// View options as accepted from clients. `filter` is validated by the
// iterative walker (see checkFilterNode) instead of a recursive zod schema,
// so depth attacks fail validation instead of the parser.
export const viewOptionsSchema = z
  .object({
    filter: z.unknown().optional(),
    sort: z
      .array(z.object({ fieldId: z.string().min(1), direction: z.enum(['asc', 'desc']) }))
      .max(MAX_SORT_ENTRIES)
      .optional(),
    group: z
      .array(z.object({ fieldId: z.string().min(1) }))
      .max(MAX_GROUP_ENTRIES)
      .optional(),
    hiddenFields: z.array(z.string()).max(MAX_HIDDEN_FIELDS).optional(),
    columnWidth: z.record(z.string(), z.number()).optional(),
  })
  .superRefine((opts, ctx) => {
    if (opts.filter !== undefined) checkFilterNode(opts.filter, ctx);
    const size = JSON.stringify(opts)?.length ?? 0;
    if (size > MAX_OPTIONS_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `View options exceed ${MAX_OPTIONS_BYTES / 1024}KB serialized`,
      });
    }
  });

export function parseViewOptions(raw: unknown): ViewOptions {
  if (!raw || typeof raw !== 'object') return {};
  // Back-compat: rows written before schema validation existed may fail these
  // checks — degrade to a blank view (no filter/sort/hidden) instead of
  // throwing; a broken stored view must never break record listing.
  const parsed = viewOptionsSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ViewOptions) : {};
}

// Strict variant for the public share path (review M-1): a share pinned to a
// view whose stored options fail today's schema must fail CLOSED. The tolerant
// {} fallback is fine for the authenticated listing (own data only) but on the
// share path it would drop filter AND hiddenFields at once — silently widening
// the share to the whole table, all fields.
export function parseViewOptionsStrict(raw: unknown): ViewOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = viewOptionsSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ViewOptions) : null;
}

// True when any condition in the tree constrains `fieldId`. This is the signal
// field.delete uses to decide which public shares must be invalidated: only a
// filter reference matters, because dropping a condition widens the row set
// (sort/group/hiddenFields references don't change which rows are exposed).
// Recursion depth is bounded by MAX_FILTER_DEPTH — write-time validation
// rejects deeper trees and tolerant parsing degrades legacy rows to {}.
export function filterReferencesField(node: FilterNode | undefined, fieldId: string): boolean {
  if (!node) return false;
  if (isFilterGroup(node)) {
    return node.conditions.some((c) => filterReferencesField(c, fieldId));
  }
  return node.fieldId === fieldId;
}

// Every fieldId an options blob references, across all reference-bearing
// keys: filter conditions (at any nesting depth — groups are walked), sort
// entries, group entries and hiddenFields. Feeds the liveness gate in
// view.updateOptions / share.create (review N4): compileCondition silently
// drops conditions whose fieldId no longer exists, which would widen the row
// set of every share pinned to the view (fail-open), so dead references must
// be rejected at write/share time instead.
//
// hiddenFields ids ARE collected even though a dead one is behaviorally
// harmless (hiding a field that doesn't exist exposes nothing): field.delete's
// cleanup (removeFieldReferences) strips dead ids from hiddenFields too, so
// validating them keeps stored options canonical — any dead id means the
// client submitted stale state after a concurrent field delete and should be
// told to resync. columnWidth keys are deliberately NOT collected: pure UI
// metadata that cleanup intentionally leaves stale, and rejecting them would
// break re-saves of every view that ever lost a field.
//
// Recursion depth is bounded by MAX_FILTER_DEPTH — write-time validation
// rejects deeper trees and tolerant parsing degrades legacy rows to {}.
export function collectReferencedFieldIds(options: ViewOptions): Set<string> {
  const ids = new Set<string>();
  const walk = (node: FilterNode): void => {
    if (isFilterGroup(node)) {
      node.conditions.forEach(walk);
      return;
    }
    ids.add(node.fieldId);
  };
  if (options.filter) walk(options.filter);
  for (const entry of options.sort ?? []) ids.add(entry.fieldId);
  for (const entry of options.group ?? []) ids.add(entry.fieldId);
  for (const id of options.hiddenFields ?? []) ids.add(id);
  return ids;
}

// Prune a fieldId out of a filter tree whose root may be either a group or a
// bare condition (checkFilterNode accepts both as root). A bare-condition
// root has no group to walk: it either references the field (filter drops to
// null) or survives untouched. An emptied group collapses to null so its
// parent drops the slot; the root collapsing to null removes the filter.
function pruneFilterTree(filter: FilterNode, fieldId: string): FilterNode | null {
  if (!isFilterGroup(filter)) {
    return filter.fieldId === fieldId ? null : filter;
  }
  const conditions: FilterNode[] = [];
  for (const child of filter.conditions) {
    if (isFilterGroup(child)) {
      const pruned = pruneFilterTree(child, fieldId);
      if (pruned) conditions.push(pruned);
    } else if (child.fieldId !== fieldId) {
      conditions.push(child);
    }
  }
  return conditions.length > 0 ? { op: filter.op, conditions } : null;
}

// Strip every reference to `fieldId` from stored view options — the cleanup
// half of field.delete (review M-2), so a deleted field can't linger as a
// condition compileCondition would silently drop. Sort/group entries and
// hiddenFields ids are filtered out; emptied arrays drop their key. Returns
// the SAME object when nothing referenced the field, letting callers skip
// pointless rewrites. columnWidth keys are left alone: pure UI metadata with
// no row-set effect once the field is gone.
export function removeFieldReferences(options: ViewOptions, fieldId: string): ViewOptions {
  const filterHit = filterReferencesField(options.filter, fieldId);
  const sortHit = options.sort?.some((s) => s.fieldId === fieldId) ?? false;
  const groupHit = options.group?.some((g) => g.fieldId === fieldId) ?? false;
  const hiddenHit = options.hiddenFields?.includes(fieldId) ?? false;
  if (!filterHit && !sortHit && !groupHit && !hiddenHit) return options;

  const next: ViewOptions = {};
  if (options.filter) {
    // The stored filter root may be a bare condition (the write gate accepts
    // one as root even though the declared type says group) — treating it as
    // a group would crash on `conditions is not iterable` and leave the field
    // undeletable (500).
    const pruned = pruneFilterTree(options.filter, fieldId);
    if (pruned) next.filter = pruned as FilterGroup;
  }
  if (options.sort) {
    const sort = options.sort.filter((s) => s.fieldId !== fieldId);
    if (sort.length > 0) next.sort = sort;
  }
  if (options.group) {
    const group = options.group.filter((g) => g.fieldId !== fieldId);
    if (group.length > 0) next.group = group;
  }
  if (options.hiddenFields) {
    const hiddenFields = options.hiddenFields.filter((id) => id !== fieldId);
    if (hiddenFields.length > 0) next.hiddenFields = hiddenFields;
  }
  if (options.columnWidth) next.columnWidth = options.columnWidth;
  return next;
}
