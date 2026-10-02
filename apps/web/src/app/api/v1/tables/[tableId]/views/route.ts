import { z } from 'zod';

import { VIEW_TYPES } from '@/lib/view-ast';
import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ tableId: string }> };

// GET /api/v1/tables/{tableId}/views — views of the table (viewer+).
export async function GET(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller }) => jsonOk(await caller.view.list({ tableId })));
}

// POST /api/v1/tables/{tableId}/views { name, type? } — editor+ (grid only
// today; other view kinds are schema-staged, not shipped).
export async function POST(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(
      req,
      z.object({
        name: z.string().trim().min(1).max(100),
        type: z.enum(VIEW_TYPES).optional(),
      }),
    );
    return jsonOk(await caller.view.create({ tableId, name: body.name, type: body.type }), 201);
  });
}
