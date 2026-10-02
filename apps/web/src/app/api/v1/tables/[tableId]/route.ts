import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ tableId: string }> };

// PATCH /api/v1/tables/{tableId} { name } — rename (editor+).
export async function PATCH(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return jsonOk(await caller.table.rename({ id: tableId, name: body.name }));
  });
}

// DELETE /api/v1/tables/{tableId} — owner only; cascades fields/records/views.
export async function DELETE(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.table.delete({ id: tableId })),
  );
}
