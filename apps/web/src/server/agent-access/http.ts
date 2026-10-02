import { TRPCError } from '@trpc/server';

import {
  contentLengthExceeds,
  createFixedWindowRateLimiter,
  MAX_API_BODY_BYTES,
  originAllowed,
  readBodyWithCap,
  readEnvNonNegativeInt,
} from '@/lib/http-guards';
import { resolveBearerToken } from './tokens';
import { agentCaller, type AgentCaller } from './agent-caller';

// One shared limiter instance across /api/v1 and /api/mcp so a client fanning
// out over both channels can't double its budget. In-process by design (single
// self-hosted container — same tradeoff as the other http-guards limiters).
const RATE_LIMITER = createFixedWindowRateLimiter(
  () => readEnvNonNegativeInt('AGENT_RATE_LIMIT_PER_MIN', 120),
  60_000,
);

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

const TRPC_TO_HTTP: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  METHOD_NOT_SUPPORTED: 405,
  INTERNAL_SERVER_ERROR: 500,
};

// TRPCErrors thrown by the caller carry user-safe messages (role/validation
// rejections) — the tRPC errorFormatter already masks driver errors before
// they reach this layer on the HTTP path. Anything non-TRPC is masked here.
export function errorResponse(err: unknown): Response {
  if (err instanceof TRPCError) {
    const status = TRPC_TO_HTTP[err.code] ?? 500;
    const message = status === 500 ? 'Internal server error' : err.message;
    return jsonError(status, err.code, message);
  }
  return jsonError(500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export interface AgentRequestContext {
  caller: AgentCaller;
  userId: string;
  /** The request, with its body already capped (identical reference for GET). */
  req: Request;
}

/**
 * Shared edge for every agent-access endpoint: Origin gate → body cap → Bearer
 * token resolution → per-token rate limit, then the caller's handler. Order
 * matters: the body cap runs BEFORE token resolution so an unauthenticated
 * request can't burn memory, and the rate limit keys on the resolved token so
 * abusers can't dodge it with bogus Authorization headers.
 */
export async function handleAgentRequest(
  req: Request,
  handler: (ctx: AgentRequestContext) => Promise<Response>,
): Promise<Response> {
  if (!originAllowed(req)) {
    return jsonError(403, 'FORBIDDEN', 'Cross-origin request rejected');
  }
  if (contentLengthExceeds(req, MAX_API_BODY_BYTES)) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large');
  }
  if (req.headers.get('content-length') === null && req.body !== null) {
    const capped = await readBodyWithCap(req, MAX_API_BODY_BYTES);
    if (capped === null) return jsonError(413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large');
    req = capped;
  }

  const resolved = await resolveBearerToken(req.headers.get('authorization'));
  if (!resolved) {
    // MCP clients key off WWW-Authenticate to start their token flow.
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API token' } }),
      {
        status: 401,
        headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
      },
    );
  }
  if (!RATE_LIMITER.allow(resolved.tokenId)) {
    return jsonError(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded — try again in a minute');
  }

  try {
    return await handler({
      caller: agentCaller(resolved.userId),
      userId: resolved.userId,
      req,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Parse a capped request body as a JSON object; 400 on anything else. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request body must be valid JSON' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request body must be a JSON object' });
  }
  return parsed as Record<string, unknown>;
}
