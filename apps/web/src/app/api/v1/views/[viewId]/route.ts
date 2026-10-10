import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ viewId: string }> };

// PATCH /api/v1/views/{viewId} { name?, options? } — rename and/or replace
// view options (filter/sort/group/hiddenFields, editor+). The options object
// is validated by the view router's viewOptionsSchema (structure/depth/size).
export async function PATCH(req: Request, { params }: Params) {
  const { viewId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(
      req,
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          options: z.record(z.string(), z.unknown()).optional(),
        })
        .refine((b) => b.name !== undefined || b.options !== undefined, {
          message: 'Provide at least one of "name" or "options"',
        }),
    );
    if (body.name !== undefined) {
      await caller.view.rename({ id: viewId, name: body.name });
    }
    if (body.options !== undefined) {
      await caller.view.updateOptions({ id: viewId, options: body.options });
    }
    return jsonOk({ ok: true });
  });
}

// DELETE /api/v1/views/{viewId} — editor+; pinned public shares die with it.
export async function DELETE(req: Request, { params }: Params) {
  const { viewId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.view.delete({ id: viewId })),
  );
}
