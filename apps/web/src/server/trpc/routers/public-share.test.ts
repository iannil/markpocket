import { describe, expect, it, vi } from 'vitest';

const mockQuery = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/server/db', () => ({
  db: { select: vi.fn().mockReturnValue(mockQuery) },
}));

import { publicShareRouter } from './public-share';

describe('publicShareRouter', () => {
  it('returns null for invalid token', async () => {
    const result = await publicShareRouter
      .createCaller({ session: null })
      .getBase({ token: 'nonexistent' });
    expect(result).toBeNull();
  });
});
