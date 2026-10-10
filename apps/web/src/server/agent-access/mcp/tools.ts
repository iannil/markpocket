import { z } from 'zod';

import { FIELD_TYPES } from '@/lib/field-types';
import { VIEW_TYPES } from '@/lib/view-ast';
import type { AgentCaller } from '../agent-caller';
import {
  createRecordWithCells,
  deleteRecord,
  getRecord,
  updateRecordCells,
} from '../records-service';

const nameSchema = z.string().trim().min(1).max(100);
const cellsSchema = z.record(z.string(), z.unknown());

export interface McpToolContext {
  caller: AgentCaller;
  userId: string;
}

interface McpToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  execute: (ctx: McpToolContext, args: z.output<S>) => Promise<unknown>;
}

/**
 * What the registry stores: schema-validated dispatch with the zod parsing
 * folded in, so heterogeneous definitions collapse to one non-generic shape.
 */
export interface RegisteredMcpTool {
  name: string;
  description: string;
  /**
   * JSON Schema for the tool's arguments (MCP tools/list descriptor).
   * `unknown` because zod's toJSONSchema return type is overload-dependent;
   * the value serializes into the tools/list response as-is.
   */
  inputSchema: () => unknown;
  execute: (ctx: McpToolContext, rawArgs: unknown) => Promise<unknown>;
}

function tool<S extends z.ZodType>(def: McpToolDefinition<S>): RegisteredMcpTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: () => z.toJSONSchema(def.input, { io: 'input' }),
    execute: (ctx, rawArgs) => def.execute(ctx, def.input.parse(rawArgs ?? {})),
  };
}

// The registry mirrors the REST surface 1:1 (ADR-0010): every tool funnels
// into the same tRPC caller + role checks as /api/v1, so behavior and
// authorization can never drift between the two channels.
export const MCP_TOOLS: RegisteredMcpTool[] = [
  tool({
    name: 'list_bases',
    description:
      'List bases allowed by both token scope and current membership. Start here to discover base ids.',
    input: z.object({}),
    execute: ({ caller }) => caller.base.list(),
  }),
  tool({
    name: 'create_base',
    description: 'Create a new base owned by the token’s user. Requires an all-base write token.',
    input: z.object({ name: nameSchema }),
    execute: ({ caller }, a) => caller.base.create(a),
  }),
  tool({
    name: 'update_base',
    description: 'Rename a base (editor role or higher).',
    input: z.object({ baseId: z.string(), name: nameSchema }),
    execute: ({ caller }, a) => caller.base.rename({ id: a.baseId, name: a.name }),
  }),
  tool({
    name: 'delete_base',
    description: 'Permanently delete a base with all its tables (owner only).',
    input: z.object({ baseId: z.string() }),
    execute: ({ caller }, a) => caller.base.delete({ id: a.baseId }),
  }),
  tool({
    name: 'list_tables',
    description: 'List the tables of a base.',
    input: z.object({ baseId: z.string() }),
    execute: ({ caller }, a) => caller.table.list(a),
  }),
  tool({
    name: 'create_table',
    description: 'Create a table inside a base; it ships with a default Grid view.',
    input: z.object({ baseId: z.string(), name: nameSchema }),
    execute: ({ caller }, a) => caller.table.create(a),
  }),
  tool({
    name: 'update_table',
    description: 'Rename a table (editor role or higher).',
    input: z.object({ tableId: z.string(), name: nameSchema }),
    execute: ({ caller }, a) => caller.table.rename({ id: a.tableId, name: a.name }),
  }),
  tool({
    name: 'delete_table',
    description: 'Permanently delete a table with its fields, records and views (owner only).',
    input: z.object({ tableId: z.string() }),
    execute: ({ caller }, a) => caller.table.delete({ id: a.tableId }),
  }),
  tool({
    name: 'list_fields',
    description:
      'List the fields of a table in UI order. Cell values in records are keyed by field id, not name — call this before writing cells.',
    input: z.object({ tableId: z.string() }),
    execute: ({ caller }, a) => caller.field.list(a),
  }),
  tool({
    name: 'create_field',
    description:
      'Add a field to a table. `type` is one of the instance’s registered field types; `options` depends on the type (e.g. select needs a choices list, link needs a target table).',
    input: z.object({
      tableId: z.string(),
      name: nameSchema,
      type: z.enum(FIELD_TYPES),
      options: z.unknown().optional(),
    }),
    execute: ({ caller }, a) =>
      caller.field.create({
        tableId: a.tableId,
        name: a.name,
        type: a.type,
        options: a.options,
      }),
  }),
  tool({
    name: 'update_field',
    description: 'Rename a field and/or replace its options (editor role or higher).',
    input: z.object({
      fieldId: z.string(),
      name: nameSchema.optional(),
      options: z.unknown().optional(),
    }),
    execute: async ({ caller }, a) => {
      if (a.name !== undefined) await caller.field.rename({ id: a.fieldId, name: a.name });
      if (a.options !== undefined)
        await caller.field.updateOptions({ id: a.fieldId, options: a.options });
      return { ok: true };
    },
  }),
  tool({
    name: 'delete_field',
    description: 'Delete a field; its cells are removed and view references cleaned.',
    input: z.object({ fieldId: z.string() }),
    execute: ({ caller }, a) => caller.field.delete({ id: a.fieldId }),
  }),
  tool({
    name: 'list_views',
    description: 'List the saved views of a table (grid views carry filter/sort/group options).',
    input: z.object({ tableId: z.string() }),
    execute: ({ caller }, a) => caller.view.list(a),
  }),
  tool({
    name: 'create_view',
    description: 'Create a view for a table (grid type only for now).',
    input: z.object({
      tableId: z.string(),
      name: nameSchema,
      type: z.enum(VIEW_TYPES).optional(),
    }),
    execute: ({ caller }, a) =>
      caller.view.create({ tableId: a.tableId, name: a.name, type: a.type }),
  }),
  tool({
    name: 'update_view',
    description:
      'Rename a view and/or replace its options ({filter?, sort?, group?, hiddenFields?}).',
    input: z.object({
      viewId: z.string(),
      name: nameSchema.optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ caller }, a) => {
      if (a.name !== undefined) await caller.view.rename({ id: a.viewId, name: a.name });
      if (a.options !== undefined)
        await caller.view.updateOptions({ id: a.viewId, options: a.options });
      return { ok: true };
    },
  }),
  tool({
    name: 'delete_view',
    description: 'Delete a view. Public shares pinned to it stop working immediately.',
    input: z.object({ viewId: z.string() }),
    execute: ({ caller }, a) => caller.view.delete({ id: a.viewId }),
  }),
  tool({
    name: 'list_records',
    description:
      'List records of a table, optionally through a saved view’s filter/sort/group. Returns {groups, total}; without grouping the records sit in groups[0].records.',
    input: z.object({
      tableId: z.string(),
      viewId: z.string().optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
    execute: ({ caller }, a) => caller.record.list(a),
  }),
  tool({
    name: 'get_record',
    description: 'Fetch one record as {id, cells} — cells maps field id → value.',
    input: z.object({ recordId: z.string() }),
    execute: (_ctx, a) => getRecord(_ctx.userId, a.recordId),
  }),
  tool({
    name: 'create_record',
    description:
      'Create a record in a table. `cells` maps field id → raw value (normalized per field type). Cells that reject their value do not fail the call — check `cellErrors` in the result.',
    input: z.object({
      tableId: z.string(),
      cells: cellsSchema.optional(),
    }),
    execute: ({ caller, userId }, a) =>
      createRecordWithCells(caller, userId, a.tableId, a.cells ?? {}),
  }),
  tool({
    name: 'update_record',
    description:
      'Update cells of an existing record. Omitted cells are untouched; an empty value clears a cell.',
    input: z.object({
      recordId: z.string(),
      cells: cellsSchema,
    }),
    execute: ({ caller, userId }, a) => updateRecordCells(caller, userId, a.recordId, a.cells),
  }),
  tool({
    name: 'delete_record',
    description: 'Delete a record; link cells elsewhere in the base are cascade-cleared.',
    input: z.object({ recordId: z.string() }),
    execute: ({ caller }, a) => deleteRecord(caller, a.recordId),
  }),
];

export const MCP_TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));
