import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { createRecordWithCells } from '@/server/agent-access/records-service';
import { parseBody, parseQuery } from '@/server/agent-access/rest';

type Params = { params: Promise<{ tableId: string }> };

const listQuery = z.object({
  // A saved view's filter/sort/group apply to the listing — agents reuse
  // views instead of posting raw filter expressions (zero new parse surface).
  viewId: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

// GET /api/v1/tables/{tableId}/records?viewId&offset&limit — viewer+.
export async function GET(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller }) => {
    // Inside the handler so query-validation failures map to the 400 envelope
    // like every other agent error, not an unhandled throw.
    const query = parseQuery(req, listQuery);
    return jsonOk(await caller.record.list({ tableId, ...query }));
  });
}

const createBody = z.object({
  // fieldId → raw value; normalized per field type. Fields that reject their
  // value don't fail the request — they come back in `cellErrors` (the record
  // itself exists by then).
  cells: z.record(z.string(), z.unknown()).optional(),
});

// POST /api/v1/tables/{tableId}/records { cells? } — editor+. Creates the
// record (expression cells materialize) then writes each cell.
export async function POST(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller, userId, req }) => {
    const body = await parseBody(req, createBody);
    return jsonOk(await createRecordWithCells(caller, userId, tableId, body.cells ?? {}), 201);
  });
}
