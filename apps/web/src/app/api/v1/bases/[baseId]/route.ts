import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ baseId: string }> };

// GET /api/v1/bases/{baseId} — single base (viewer+).
export async function GET(req: Request, { params }: Params) {
  const { baseId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.base.get({ id: baseId })),
  );
}

// PATCH /api/v1/bases/{baseId} { name } — rename (editor+).
export async function PATCH(req: Request, { params }: Params) {
  const { baseId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return jsonOk(await caller.base.rename({ id: baseId, name: body.name }));
  });
}

// DELETE /api/v1/bases/{baseId} — owner only.
export async function DELETE(req: Request, { params }: Params) {
  const { baseId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.base.delete({ id: baseId })),
  );
}
