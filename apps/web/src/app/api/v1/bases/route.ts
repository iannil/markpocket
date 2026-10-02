import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

// GET /api/v1/bases — bases the token's user is a member of.
export async function GET(req: Request) {
  return handleAgentRequest(req, async ({ caller }) => jsonOk(await caller.base.list()));
}

// POST /api/v1/bases { name } — creates a base owned by the token's user.
export async function POST(req: Request) {
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return jsonOk(await caller.base.create(body), 201);
  });
}
