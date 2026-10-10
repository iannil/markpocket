import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), role: vi.fn() }));
vi.mock('@/server/db', () => ({ db: { select: mocks.select, insert: mocks.insert } }));
vi.mock('@/lib/roles', () => ({ assertRole: mocks.role }));
vi.mock('./view', () => ({ findDeadFieldReferences: vi.fn().mockResolvedValue([]) }));
import { shareRouter } from './share';
it('rejects creation of a read-only share for a Form before minting a token', async () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{ id: 'v', tableId: 't', type: 'form', options: {} }]),
  };
  mocks.select.mockReturnValue(chain);
  const caller = shareRouter.createCaller({
    session: { user: { id: 'u' }, session: { id: 's' } },
  } as Parameters<typeof shareRouter.createCaller>[0]);
  await expect(caller.create({ baseId: 'b', viewId: 'v' })).rejects.toThrow(
    'Form views use submission links',
  );
  expect(mocks.insert).not.toHaveBeenCalled();
});
