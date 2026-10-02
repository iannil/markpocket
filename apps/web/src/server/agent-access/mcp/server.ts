import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { packageVersion } from '../version';
import {
  failure,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  METHOD_NOT_FOUND,
  success,
} from './json-rpc';
import { MCP_TOOLS, MCP_TOOL_BY_NAME, type McpToolContext } from './tools';

// Protocol versions this server speaks (initialize echoes the client's
// requested version when it's in this set, else falls back to the newest).
// 2024-11-05 has no MCP-Protocol-Version header semantics but the message
// shapes we implement are identical.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INFO = {
  name: 'markpocket',
  version: packageVersion,
} as const;

export const SERVER_INSTRUCTIONS =
  'Work with bases → tables → fields → records. Ids are opaque strings: discover them with list_bases / list_tables / list_fields before writing. Record cells are keyed by field id; call list_fields first. Mutations require the editor role on the base (delete base/table requires owner).';

// Escape hatch for protocol-level failures raised inside callTool: they must
// surface as JSON-RPC errors, unlike tool execution failures (see below).
class McpProtocolError extends Error {
  constructor(public build: () => JsonRpcResponse) {
    super('mcp protocol error');
  }
}

function initializeResult(requested: unknown): object {
  const version =
    typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  };
}

function toolDescriptors(): Array<{ name: string; description: string; inputSchema: unknown }> {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema(),
  }));
}

/**
 * Execute a tools/call and shape the MCP result. Per the spec, tool EXECUTION
 * failures are results with isError: true (so the model can read the reason),
 * while unknown tools / bad arguments are JSON-RPC errors.
 */
async function callTool(ctx: McpToolContext, name: string, rawArgs: unknown): Promise<object> {
  const tool = MCP_TOOL_BY_NAME.get(name);
  if (!tool) {
    throw new McpProtocolError(() => failure(null, METHOD_NOT_FOUND, `Unknown tool: ${name}`));
  }
  try {
    const result = await tool.execute(ctx, rawArgs);
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
  } catch (err) {
    // Argument-shape failures surface as JSON-RPC -32602 (the client sent a
    // malformed call), distinct from execution failures below.
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      throw new McpProtocolError(() =>
        failure(
          null,
          INVALID_PARAMS,
          `Invalid arguments${first?.path?.length ? ` at ${first.path.join('.')}` : ''}: ${first?.message ?? 'validation failed'}`,
        ),
      );
    }
    // Role/validation rejections (TRPCError) carry agent-safe messages.
    const message =
      err instanceof TRPCError ? `${err.code}: ${err.message}` : 'Tool execution failed';
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export interface McpDispatchResult {
  /** The JSON-RPC response to serialize, or null for notifications (→ 202). */
  response: JsonRpcResponse | null;
  status: number;
}

/**
 * Dispatch one decoded JSON-RPC message. Pure protocol layer: HTTP concerns
 * (origin/auth/body caps) are handled by the route before this runs.
 */
export async function dispatchMcpMessage(
  ctx: McpToolContext,
  message: JsonRpcRequest | { jsonrpc: '2.0'; method: string; params?: unknown },
): Promise<McpDispatchResult> {
  const isRequest = 'id' in message && message.id !== undefined;
  const id: JsonRpcId | null = isRequest ? (message as JsonRpcRequest).id : null;

  try {
    if (!isRequest) {
      // Notifications (no id) — including notifications/initialized — get no
      // response body, just 202 Accepted.
      return { response: null, status: 202 };
    }
    const request = message as JsonRpcRequest;
    const params = request.params as Record<string, unknown> | undefined;
    switch (request.method) {
      case 'initialize':
        return {
          response: success(request.id, initializeResult(params?.protocolVersion)),
          status: 200,
        };
      case 'ping':
        return { response: success(request.id, {}), status: 200 };
      case 'tools/list':
        return { response: success(request.id, { tools: toolDescriptors() }), status: 200 };
      case 'tools/call': {
        if (!params || typeof params.name !== 'string') {
          return {
            response: failure(request.id, INVALID_PARAMS, 'tools/call requires params.name'),
            status: 200,
          };
        }
        const result = await callTool(ctx, params.name, params.arguments);
        return { response: success(request.id, result), status: 200 };
      }
      default:
        return {
          response: failure(request.id, METHOD_NOT_FOUND, `Method not found: ${request.method}`),
          status: 200,
        };
    }
  } catch (err) {
    if (err instanceof McpProtocolError) return { response: err.build(), status: 200 };
    // Unexpected internal failure: generic error, no internals leaked.
    return { response: failure(id, INTERNAL_ERROR, 'Internal server error'), status: 200 };
  }
}
