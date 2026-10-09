import { beforeEach, expect, it, vi } from 'vitest';
import { session } from './__test-utils';

const mocks = vi.hoisted(() => ({ exportBaseCsv: vi.fn() }));
vi.mock('@/server/exports/csv', () => mocks);

import { exportRouter } from './export';

beforeEach(() => vi.resetAllMocks());

it('forwards the selected tables and authenticated user to the export service', async () => {
  const files = [{ tableId: 't1', name: 'Test-t1.csv', csv: 'Name', total: 0, truncated: false }];
  mocks.exportBaseCsv.mockResolvedValue(files);
  expect(
    await exportRouter.createCaller(session()).exportBase({ baseId: 'b1', tableIds: ['t1'] }),
  ).toEqual(files);
  expect(mocks.exportBaseCsv).toHaveBeenCalledWith('b1', 'u1', ['t1']);
});

it('does not turn a service failure into partial files', async () => {
  mocks.exportBaseCsv.mockRejectedValue(new Error('export rejected'));
  await expect(exportRouter.createCaller(session()).exportBase({ baseId: 'b1' })).rejects.toThrow(
    'export rejected',
  );
});
