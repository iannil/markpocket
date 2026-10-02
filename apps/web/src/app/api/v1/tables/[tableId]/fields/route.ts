import { z } from 'zod';

import { FIELD_TYPES } from '@/lib/field-types';
import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ tableId: string }> };

// GET /api/v1/tables/{tableId}/fields — field list in UI order (viewer+).
export async function GET(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.field.list({ tableId })),
  );
}

// POST /api/v1/tables/{tableId}/fields { name, type, options? } — editor+.
// `type`/`options` semantics (including link-target checks and the 64KB
// options cap) are validated by the field router itself.
export async function POST(req: Request, { params }: Params) {
  const { tableId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(
      req,
      z.object({
        name: z.string().trim().min(1).max(100),
        type: z.enum(FIELD_TYPES),
        options: z.unknown().optional(),
      }),
    );
    return jsonOk(
      await caller.field.create({
        tableId,
        name: body.name,
        type: body.type,
        options: body.options,
      }),
      201,
    );
  });
}
