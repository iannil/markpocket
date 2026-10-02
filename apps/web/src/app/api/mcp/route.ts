import { handleAgentRequest } from '@/server/agent-access/http';
import { dispatchMcpMessage } from '@/server/agent-access/mcp/server';
import {
  failure,
  INVALID_REQUEST,
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  PARSE_ERROR,
} from '@/server/agent-access/mcp/json-rpc';

// POST /api/mcp — MCP streamable HTTP transport (stateless: one JSON-RPC
// message per request, plain application/json responses, no server-push SSE).
// Auth, Origin, body cap and rate limiting come from the shared agent edge
// (handleAgentRequest); 401 carries WWW-Authenticate: Bearer per the MCP
// auth convention.
export async function POST(req: Request) {
  return handleAgentRequest(req, async (ctx) => {
    let raw: unknown;
    try {
      raw = await ctx.req.json();
    } catch {
      return Response.json(failure(null, PARSE_ERROR, 'Body must be valid JSON'), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const request = jsonRpcRequestSchema.safeParse(raw);
    const notification = jsonRpcNotificationSchema.safeParse(raw);
    if (!request.success && !notification.success) {
      // Batching (arrays) is intentionally unsupported — this server is
      // stateless and single-message by design (ADR-0010).
      return Response.json(
        failure(null, INVALID_REQUEST, 'Expected a single JSON-RPC 2.0 message'),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const { response, status } = await dispatchMcpMessage(ctx, raw as never);
    if (response === null) {
      // Notification: accepted, nothing to say.
      return new Response(null, { status: 202 });
    }
    return Response.json(response, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

// The streamable-HTTP spec allows servers without server-initiated messages
// to decline the SSE stream and session termination; both get 405 here.
export async function GET() {
  return Response.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'SSE stream not supported — POST JSON-RPC messages instead',
      },
    },
    { status: 405, headers: { allow: 'POST' } },
  );
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
