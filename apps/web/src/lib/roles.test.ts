import { describe, expect, it, vi } from 'vitest';

// Mock the db module to avoid real DB connections. The chain returns an empty
// result set so baseIdFromTable resolves to null.
vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}));

import { baseIdFromTable } from './roles';

describe('baseIdFromTable', () => {
  it('returns null when table is not found', async () => {
    const result = await baseIdFromTable('nonexistent');
    expect(result).toBeNull();
  });
});
