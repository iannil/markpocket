import { beforeEach, expect, it, vi } from 'vitest';
import { mockDb, session } from './__test-utils';
vi.mock('@/server/db', () => ({ db: mockDb() }));

const mocks = vi.hoisted(() => ({
  preflightImport: vi.fn(),
  startImport: vi.fn(),
  importStatus: vi.fn(),
  cancelImport: vi.fn(),
}));
vi.mock('@/server/imports/airtable/service', () => mocks);
import { airtableImportRouter } from './airtable-import';

const requestId = '550e8400-e29b-41d4-a716-446655440000';
const valid = {
  requestId,
  sourceBaseId: 'app12345678',
  token: 'pat-secret',
  name: 'Imported',
  schemaHash: 'a'.repeat(64),
  acceptLosses: true,
};
beforeEach(() => vi.resetAllMocks());

it('requires a session and forwards only the authenticated identity', async () => {
  mocks.preflightImport.mockResolvedValue({ schemaHash: valid.schemaHash, tables: [], issues: [] });
  mocks.startImport.mockResolvedValue({ requestId, baseId: 'b1', issues: [] });
  mocks.importStatus.mockResolvedValue({ status: 'not-running' });
  mocks.cancelImport.mockResolvedValue({ cancelled: true });
  const caller = airtableImportRouter.createCaller(session({ id: 'owner' }));
  await caller.preflight({ sourceBaseId: valid.sourceBaseId, token: valid.token });
  await caller.start(valid);
  await caller.status({ requestId });
  await caller.cancel({ requestId });
  expect(mocks.preflightImport).toHaveBeenCalledWith('owner', valid.sourceBaseId, valid.token);
  expect(mocks.startImport).toHaveBeenCalledWith('owner', valid);
  expect(mocks.importStatus).toHaveBeenCalledWith('owner', requestId);
  expect(mocks.cancelImport).toHaveBeenCalledWith('owner', requestId);
  await expect(
    airtableImportRouter.createCaller({ session: null }).status({ requestId }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.status({ requestId, userId: 'other' } as never)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(caller.cancel({ requestId, userId: 'other' } as never)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

it('validates bounded credentials, identifiers, names, and hash before service calls', async () => {
  const caller = airtableImportRouter.createCaller(session());
  for (const input of [
    { ...valid, requestId: 'bad' },
    { ...valid, sourceBaseId: 'bad' },
    { ...valid, token: 'x'.repeat(1025) },
    { ...valid, name: 'x'.repeat(65) },
    { ...valid, name: ' ' },
    { ...valid, schemaHash: 'bad' },
  ])
    await expect(caller.start(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(mocks.startImport).not.toHaveBeenCalled();
  await expect(
    caller.preflight({ sourceBaseId: valid.sourceBaseId, token: '' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('keeps credential calls as mutations and masks ordinary failures', async () => {
  expect(airtableImportRouter._def.procedures.preflight._def.type).toBe('mutation');
  expect(airtableImportRouter._def.procedures.start._def.type).toBe('mutation');
  expect(airtableImportRouter._def.procedures.status._def.type).toBe('query');
  mocks.startImport.mockRejectedValue(new Error('database password secret'));
  await expect(airtableImportRouter.createCaller(session()).start(valid)).rejects.toMatchObject({
    message: 'Import failed; retry with the same request ID',
  });
});
