import { describe, beforeEach, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

// Drive the real roles.ts logic against a mock db. The mock distinguishes
// queries by table identity: roles.ts selects from `baseMember` for
// getMembership/assertRole and from `table` for baseIdFromTable, so both
// row sets can be steered per test.
const mock = vi.hoisted(() => {
  const baseMember = { __table: 'baseMember' };
  const table = { __table: 'table' };
  const state: {
    membershipRows: Array<{ baseId: string; userId: string; role: string }>;
    tableRows: Array<{ baseId: string }>;
  } = { membershipRows: [], tableRows: [] };
  return {
    state,
    schema: { baseMember, table },
    db: {
      select: vi.fn(() => ({
        from: (t: { __table: string }) => ({
          where: () => ({
            limit: async () =>
              t.__table === 'baseMember' ? state.membershipRows : state.tableRows,
          }),
        }),
      })),
    },
  };
});

vi.mock('@/server/db/schema', () => mock.schema);
vi.mock('@/server/db', () => ({ db: mock.db }));

import { assertRole, assertTableRole, baseIdFromTable, getMembership } from './roles';
import type { Role } from './roles';

// Set the membership row the mocked db will return for (baseId, userId).
function beMember(role: Role) {
  mock.state.membershipRows = [{ baseId: 'b1', userId: 'u1', role }];
}

async function expectTrpcError(promise: Promise<void>, code: string, message: string) {
  let err: unknown;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe(code);
  expect((err as TRPCError).message).toContain(message);
}

beforeEach(() => {
  mock.state.membershipRows = [];
  mock.state.tableRows = [{ baseId: 'b1' }];
});

describe('getMembership', () => {
  it.each(['owner', 'editor', 'viewer'] as const)('returns "%s" for a member', async (role) => {
    beMember(role);
    expect(await getMembership('b1', 'u1')).toBe(role);
  });

  it('returns null for a non-member', async () => {
    expect(await getMembership('b1', 'u1')).toBeNull();
  });
});

describe('assertRole truth table (member role × required role)', () => {
  // [memberRole, requiredRole, shouldPass]
  const truthTable: Array<[Role, Role, boolean]> = [
    ['owner', 'viewer', true],
    ['owner', 'editor', true],
    ['owner', 'owner', true],
    ['editor', 'viewer', true],
    ['editor', 'editor', true],
    ['editor', 'owner', false],
    ['viewer', 'viewer', true],
    ['viewer', 'editor', false],
    ['viewer', 'owner', false],
  ];

  it.each(truthTable)('%s satisfies a %s-level gate (pass=%s)', async (role, minRole, pass) => {
    beMember(role);
    if (pass) {
      await expect(assertRole('b1', 'u1', minRole)).resolves.toBeUndefined();
    } else {
      await expectTrpcError(
        assertRole('b1', 'u1', minRole),
        'FORBIDDEN',
        `Requires ${minRole} role (you are ${role})`,
      );
    }
  });

  it.each(['viewer', 'editor', 'owner'] as const)(
    'rejects a non-member even at the lowest gate (%s)',
    async (minRole) => {
      await expectTrpcError(
        assertRole('b1', 'u1', minRole),
        'FORBIDDEN',
        'Not a member of this base',
      );
    },
  );
});

describe('baseIdFromTable', () => {
  it('resolves the base when the table exists', async () => {
    expect(await baseIdFromTable('t1')).toBe('b1');
  });

  it('returns null when the table does not exist', async () => {
    mock.state.tableRows = [];
    expect(await baseIdFromTable('missing')).toBeNull();
  });
});

describe('assertTableRole', () => {
  it('passes when the table exists and the role suffices', async () => {
    beMember('viewer');
    await expect(assertTableRole('t1', 'u1', 'viewer')).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND when the table does not exist (before any membership check)', async () => {
    beMember('owner'); // even an owner cannot pass a bogus table id
    mock.state.tableRows = [];
    await expectTrpcError(
      assertTableRole('missing', 'u1', 'viewer'),
      'NOT_FOUND',
      'Table not found',
    );
  });

  it('throws FORBIDDEN for a non-member even when the table exists', async () => {
    await expectTrpcError(
      assertTableRole('t1', 'u1', 'viewer'),
      'FORBIDDEN',
      'Not a member of this base',
    );
  });

  it('throws FORBIDDEN when the role is insufficient', async () => {
    beMember('viewer');
    await expectTrpcError(
      assertTableRole('t1', 'u1', 'editor'),
      'FORBIDDEN',
      'Requires editor role (you are viewer)',
    );
  });
});
