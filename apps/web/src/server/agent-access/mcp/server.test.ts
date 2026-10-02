/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

// The tools registry pulls in records-service → db at import time; the real
// db module throws without DATABASE_URL, so stub it (no test here touches db).
vi.mock('@/server/db', () => ({ db: {} }));

import { dispatchMcpMessage, LATEST_PROTOCOL_VERSION, SERVER_INFO } from './server';
import { MCP_TOOLS, MCP_TOOL_BY_NAME } from './tools';

const ctx = { caller: {} as any, userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initialize', () => {
  it('echoes a supported requested protocol version', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect((response as any).result.protocolVersion).toBe('2025-03-26');
    expect((response as any).result.capabilities.tools).toBeDefined();
    expect((response as any).result.serverInfo.name).toBe(SERVER_INFO.name);
  });

  it('falls back to the newest version for unknown/missing requests', async () => {
    for (const params of [undefined, { protocolVersion: '1999-01-01' }]) {
      const { response } = await dispatchMcpMessage(ctx, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params,
      });
      expect((response as any).result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    }
  });
});

describe('lifecycle messages', () => {
  it('answers ping with an empty result', async () => {
    const { response } = await dispatchMcpMessage(ctx, { jsonrpc: '2.0', id: 2, method: 'ping' });
    expect((response as any).result).toEqual({});
  });

  it('accepts notifications with 202 and no body', async () => {
    const { response, status } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response).toBeNull();
    expect(status).toBe(202);
  });

  it('reports unknown methods as -32601', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    });
    expect((response as any).error.code).toBe(-32601);
  });
});

describe('tools/list', () => {
  it('exposes every registered tool with a JSON Schema inputSchema', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
    });
    const tools = (response as any).result.tools as Array<{
      name: string;
      description: string;
      inputSchema: any;
    }>;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe('object');
    }
    expect(MCP_TOOL_BY_NAME.has('create_record')).toBe(true);
    expect(MCP_TOOL_BY_NAME.has('delete_view')).toBe(true);
  });
});

describe('tools/call', () => {
  it('returns serialized tool output as text content', async () => {
    const listTool = vi.fn().mockResolvedValue([{ id: 'b1', name: 'Ops' }]);
    const { response } = await dispatchMcpMessage(
      { caller: { base: { list: listTool } } as any, userId: 'u1' },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_bases' } },
    );
    const result = (response as any).result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'b1', name: 'Ops' }]);
  });

  it('maps TRPCError rejections to isError results, not JSON-RPC errors', async () => {
    const listTool = vi
      .fn()
      .mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Requires editor role' }));
    const { response } = await dispatchMcpMessage(
      { caller: { base: { list: listTool } } as any, userId: 'u1' },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_bases' } },
    );
    const result = (response as any).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('FORBIDDEN');
    expect((response as any).error).toBeUndefined();
  });

  it('masks non-TRPC execution failures', async () => {
    const listTool = vi.fn().mockRejectedValue(new Error('db password is hunter2'));
    const { response } = await dispatchMcpMessage(
      { caller: { base: { list: listTool } } as any, userId: 'u1' },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_bases' } },
    );
    const result = (response as any).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('hunter2');
  });

  it('answers -32601 for unknown tools', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'no_such_tool' },
    });
    expect((response as any).error.code).toBe(-32601);
  });

  it('answers -32602 for arguments that fail the tool schema', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'list_records', arguments: { limit: 99999 } },
    });
    expect((response as any).error.code).toBe(-32602);
  });

  it('answers -32602 when params.name is missing', async () => {
    const { response } = await dispatchMcpMessage(ctx, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {},
    });
    expect((response as any).error.code).toBe(-32602);
  });
});
