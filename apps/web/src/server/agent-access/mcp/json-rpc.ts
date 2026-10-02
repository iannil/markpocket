import { z } from 'zod';

// JSON-RPC 2.0 envelope types for the MCP streamable-HTTP transport
// (ADR-0010: hand-rolled subset — initialize / notifications / ping /
// tools/list / tools/call; no sessions, no server-push SSE).

export const jsonRpcIdSchema = z.union([z.string(), z.number()]);

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema,
  method: z.string(),
  params: z.unknown().optional(),
});

export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});

export type JsonRpcId = z.output<typeof jsonRpcIdSchema>;
export type JsonRpcRequest = z.output<typeof jsonRpcRequestSchema>;

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorBody;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// Standard JSON-RPC / MCP error codes.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
