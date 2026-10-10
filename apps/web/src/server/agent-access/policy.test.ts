import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertAgentProcedure } from './policy';
import { runWithTokenScope } from './scope';
import { ACCESS_CASES } from './scoped-access-cases';

const reads = [
  'base.list',
  'base.get',
  'table.list',
  'table.get',
  'field.list',
  'view.list',
  'record.list',
  'record.get',
  'record.groupCounts',
  'record.kanbanPage',
];
const writes = [
  'base.create',
  'base.rename',
  'base.delete',
  'table.create',
  'table.rename',
  'table.delete',
  'field.create',
  'field.rename',
  'field.updateOptions',
  'field.delete',
  'view.create',
  'view.rename',
  'view.updateOptions',
  'view.delete',
  'record.create',
  'record.delete',
  'cell.upsert',
];
const scope = { tokenId: 'test', userId: 'user', baseId: null, access: 'write' } as const;

describe('agent procedure allowlist', () => {
  it.each(reads)('allows scoped read %s but rejects wrong procedure types', (path) => {
    runWithTokenScope({ ...scope, access: 'read', baseId: 'base' }, () => {
      expect(() => assertAgentProcedure(path, 'query')).not.toThrow();
      expect(() => assertAgentProcedure(path, 'mutation')).toThrow();
      expect(() => assertAgentProcedure(path, 'subscription')).toThrow();
    });
  });
  it.each(writes)('allows all-base write %s and rejects read token writes', (path) => {
    runWithTokenScope(scope, () => {
      expect(() => assertAgentProcedure(path, 'mutation')).not.toThrow();
      expect(() => assertAgentProcedure(path, 'query')).toThrow();
    });
    runWithTokenScope({ ...scope, access: 'read' }, () => {
      expect(() => assertAgentProcedure(path, 'mutation')).toThrow('Read-only token');
    });
  });
  it.each([
    'token.create',
    'token.list',
    'token.revoke',
    'share.create',
    'invite.create',
    'member.list',
    'form.publish',
    'record.writeBatch',
    'workspace.list',
    'plugin.future',
    'base.future',
  ])('denies unpublished procedure %s for write tokens', (path) => {
    runWithTokenScope(scope, () => {
      for (const type of ['query', 'mutation', 'subscription'] as const) {
        expect(() => assertAgentProcedure(path, type)).toThrow('Procedure is not available');
      }
    });
  });
  it('blocks bound base creation without restricting browser sessions', () => {
    runWithTokenScope({ ...scope, baseId: 'base' }, () => {
      expect(() => assertAgentProcedure('base.create', 'mutation')).toThrow('Token is bound');
    });
    expect(() => assertAgentProcedure('token.create', 'mutation')).not.toThrow();
  });
});

describe('scope matrix surface coverage', () => {
  it('names every actual REST route export, with OpenAPI explicitly public', async () => {
    const root = new URL('../../app/api/v1/', import.meta.url);
    const files = (await readdir(root, { recursive: true })).filter((file) =>
      file.endsWith('route.ts'),
    );
    const actual: string[] = [];
    for (const file of files) {
      const source = await readFile(new URL(file, root), 'utf8');
      const methods = [
        ...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\(/g),
      ].map((m) => m[1]);
      if (file === 'openapi.json/route.ts') {
        expect(methods).toEqual(['GET']);
      } else {
        actual.push(...methods.map((method) => `${method} ${file.replace('/route.ts', '')}`));
      }
    }
    expect(actual.sort()).toEqual(ACCESS_CASES.map((c) => `${c.method} ${c.path}`).sort());
  });
  it('names every MCP tool in the registry', async () => {
    // Read registry source without loading DB dependencies in the normal unit suite.
    const source = await readFile(new URL('./mcp/tools.ts', import.meta.url), 'utf8');
    const actual = [...source.matchAll(/^ {4}name: '([^']+)',/gm)].map((m) => m[1]);
    expect(actual.sort()).toEqual(ACCESS_CASES.flatMap((c) => (c.tool ? [c.tool] : [])).sort());
  });
});
