import { sql, type SQL } from 'drizzle-orm';

import { FieldType, type FieldOptions } from './field-types';
import { isFilterGroup, type FilterNode, type GroupSpec, type SortSpec } from './view-ast';

type FieldMap = Map<string, { type: string; options: FieldOptions }>;

// `c.value #>> '{}'` extracts the JSONB scalar as text. Injected literally (constant
// string — not user input), so sql.raw is safe here.
function scalarRaw(): SQL {
  return sql.raw("c.value #>> '{}'");
}

function valueOp(type: string, operator: string, operand: unknown): SQL | null {
  const s = scalarRaw();
  switch (operator) {
    case 'equals':
      return type === FieldType.Number
        ? sql`(${s})::numeric = ${Number(operand)}`
        : sql`${s} = ${String(operand)}`;
    case 'ne':
      return type === FieldType.Number
        ? sql`(${s})::numeric <> ${Number(operand)}`
        : sql`${s} <> ${String(operand)}`;
    case 'contains':
      return sql`${s} ILIKE ${`%${String(operand)}%`}`;
    case 'startsWith':
      return sql`${s} ILIKE ${`${String(operand)}%`}`;
    case 'gt':
      return sql`(${s})::numeric > ${Number(operand)}`;
    case 'lt':
      return sql`(${s})::numeric < ${Number(operand)}`;
    case 'gte':
      return sql`(${s})::numeric >= ${Number(operand)}`;
    case 'lte':
      return sql`(${s})::numeric <= ${Number(operand)}`;
    case 'is':
      return sql`(${s})::boolean = ${String(operand) === 'true'}`;
    case 'before':
      return sql`${s} < ${String(operand)}`;
    case 'after':
      return sql`${s} > ${String(operand)}`;
    default:
      return null;
  }
}

function compileCondition(
  cond: Extract<FilterNode, { fieldId: string }>,
  fields: FieldMap,
): SQL | null {
  const field = fields.get(cond.fieldId);
  if (!field) return null;

  if (cond.operator === 'empty') {
    return sql`NOT EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = ${cond.fieldId})`;
  }
  if (cond.operator === 'notEmpty') {
    return sql`EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = ${cond.fieldId})`;
  }

  const op = valueOp(field.type, cond.operator, cond.operand);
  if (!op) return null;
  return sql`EXISTS (SELECT 1 FROM cell c WHERE c.record_id = record.id AND c.field_id = ${cond.fieldId} AND ${op})`;
}

export function compileFilter(node: FilterNode | undefined, fields: FieldMap): SQL | null {
  if (!node) return null;
  if (isFilterGroup(node)) {
    const parts = node.conditions
      .map((c) => compileFilter(c, fields))
      .filter((x): x is SQL => x !== null);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    const kw = node.op === 'or' ? sql.raw('OR') : sql.raw('AND');
    return sql`(${parts.reduce((acc, p) => sql`${acc} ${kw} ${p}`)})`;
  }
  return compileCondition(node, fields);
}

export function compileSort(sort: SortSpec[] | undefined, fields: FieldMap): SQL | null {
  if (!sort?.length) return null;
  const clauses = sort.map((spec) => {
    const field = fields.get(spec.fieldId);
    const rawText = "c.value #>> '{}'";
    let expr: SQL;
    if (field?.type === FieldType.Number) {
      expr = sql`(${sql.raw(rawText)})::numeric`;
    } else if (field?.type === FieldType.Boolean) {
      expr = sql`(${sql.raw(rawText)})::boolean`;
    } else {
      // text / date / single-select: text or ISO-string compare is correct.
      expr = sql.raw(rawText);
    }
    const dir = spec.direction === 'desc' ? sql.raw('DESC') : sql.raw('ASC');
    return sql`(SELECT ${expr} FROM cell c WHERE c.record_id = record.id AND c.field_id = ${spec.fieldId}) ${dir} NULLS LAST`;
  });
  return clauses.reduce((acc, c) => sql`${acc}, ${c}`);
}

export function applyGroup<T extends { id: string; cells: Record<string, unknown> }>(
  records: T[],
  group: GroupSpec[] | undefined,
): { key: string | null; records: T[] }[] {
  if (!group?.length) return [{ key: null, records }];
  const fieldId = group[0]!.fieldId;
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of records) {
    const v = r.cells[fieldId];
    const key = v == null || v === '' ? '__empty__' : String(v);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(r);
  }
  return order.map((k) => ({
    key: k === '__empty__' ? null : k,
    records: buckets.get(k)!,
  }));
}
