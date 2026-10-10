import { z } from 'zod';

import { handleAgentRequest, jsonOk } from '@/server/agent-access/http';
import { parseBody } from '@/server/agent-access/rest';

type Params = { params: Promise<{ fieldId: string }> };

// PATCH /api/v1/fields/{fieldId} { name?, options? } — rename and/or replace
// options (editor+). Both are optional but at least one is required; options
// structure is validated by the field router.
export async function PATCH(req: Request, { params }: Params) {
  const { fieldId } = await params;
  return handleAgentRequest(req, async ({ caller, req }) => {
    const body = await parseBody(
      req,
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          options: z.unknown().optional(),
        })
        .refine((b) => b.name !== undefined || b.options !== undefined, {
          message: 'Provide at least one of "name" or "options"',
        }),
    );
    if (body.name !== undefined) {
      await caller.field.rename({ id: fieldId, name: body.name });
    }
    if (body.options !== undefined) {
      await caller.field.updateOptions({ id: fieldId, options: body.options });
    }
    return jsonOk({ ok: true });
  });
}

// DELETE /api/v1/fields/{fieldId} — editor+; cleans view references and
// rewrites/deletes cells of this field.
export async function DELETE(req: Request, { params }: Params) {
  const { fieldId } = await params;
  return handleAgentRequest(req, async ({ caller }) =>
    jsonOk(await caller.field.delete({ id: fieldId })),
  );
}
