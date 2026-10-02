import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ baseId: string }> };

// GET /api/v1/bases/{baseId}/tables — tables in creation order (viewer+).
export async function GET(req: Request, { params }: Params) {
  const { baseId } = await params;
  return handleAgentRequest(req, async ({ caller }) => jsonOk(await caller.table.list({ baseId })));
}

// POST /api/v1/bases/{baseId}/tables { name } — creates a table with a default
// Grid view (editor+).
export async function POST(req: Request, { params }: Params) {
  const { baseId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return jsonOk(await caller.table.create({ baseId, name: body.name }), 201);
  });
}
