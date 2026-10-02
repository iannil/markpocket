import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { deleteRecord, getRecord, updateRecordCells } from '@/server/agent-access/records-service';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ recordId: string }> };

// GET /api/v1/records/{recordId} — single pivoted record (viewer+).
export async function GET(req: Request, { params }: Params) {
  const { recordId } = await params;
  return handleAgentRequest(req, async ({ userId }) => jsonOk(await getRecord(userId, recordId)));
}

const patchBody = z.object({
  // fieldId → new value. Unmentioned cells are untouched; an empty value
  // clears a cell (row-per-cell storage: empty = no row).
  cells: z.record(z.string(), z.unknown()),
});

// PATCH /api/v1/records/{recordId} { cells } — editor+.
export async function PATCH(req: Request, { params }: Params) {
  const { recordId } = await params;
  return handleAgentRequest(req, async ({ caller, userId, req }) => {
    const body = await parseBody(req, patchBody);
    return jsonOk(await updateRecordCells(caller, userId, recordId, body.cells));
  });
}

// DELETE /api/v1/records/{recordId} — editor+; link cells elsewhere in the
// base are cascade-cleared by the underlying procedure.
export async function DELETE(req: Request, { params }: Params) {
  const { recordId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await deleteRecord(caller, recordId)),
  );
}
