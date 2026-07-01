// View options AST (Q7b). Types only — the filter/sort/group shapes are validated
// and executed in lib/view-query; here we just declare the structure.

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
  filter?: FilterGroup;
  sort?: SortSpec[];
  group?: GroupSpec[];
  hiddenFields?: string[];
  columnWidth?: Record<string, number>;
}

export const EMPTY_VIEW_OPTIONS: ViewOptions = {};

export function parseViewOptions(raw: unknown): ViewOptions {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ViewOptions;
}
