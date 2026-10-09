import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createImportService } from './service';
import { preflight } from './mapping';
import type { AirtableSource, ImportReport } from './types';
const schema = { tables: [{ id: 'tblEmpty', name: 'Empty', fields: [] }] };
const input = () => ({
  requestId: randomUUID(),
  sourceBaseId: 'appFixture',
  token: 'private-token',
  name: 'Import',
  schemaHash: preflight(schema, 'appFixture').schemaHash,
  acceptLosses: true,
});
const source: AirtableSource = {
  schema: async () => schema,
  async *records() {
    yield [];
  },
  attachment: async () => Buffer.alloc(0),
};
const report = (id: string): ImportReport => ({
  requestId: id,
  sourceBaseId: 'appFixture',
  baseId: 'target',
  tables: [],
  records: 0,
  cells: 0,
  attachments: 0,
  attachmentBytes: 0,
  issues: [],
});

describe('import lifecycle', () => {
  it('returns receipt before touching credentials or source', async () => {
    const request = input(),
      factory = vi.fn();
    const service = createImportService({
      source: factory,
      importer: { receipt: async () => report(request.requestId), write: vi.fn() },
    });
    expect(await service.startImport('user', { ...request, token: '' })).toEqual(
      report(request.requestId),
    );
    expect(factory).not.toHaveBeenCalled();
  });
  it('isolates active status/cancel and releases slot after abort and error', async () => {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = createImportService({
      source: () => ({
        ...source,
        schema: async (_id, _token, signal) => {
          entered();
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(Error('private-token')), { once: true }),
          );
          return schema;
        },
      }),
      importer: { receipt: async () => undefined, write: vi.fn() },
    });
    const request = input();
    const running = service.startImport('user', request);
    const assertion = expect(running).rejects.toThrow('cancelled');
    await ready;
    await expect(service.importStatus('other', request.requestId)).rejects.toThrow('Access denied');
    await expect(service.cancelImport('other', request.requestId)).rejects.toThrow('Access denied');
    expect((await service.importStatus('user', request.requestId)).status).toBe('running');
    expect(await service.cancelImport('user', request.requestId)).toEqual({ cancelled: true });
    await assertion;
    expect(await service.importStatus('user', request.requestId)).toEqual({
      status: 'not-running',
    });
  });
  it('deadline aborts network and commit winning cancellation returns completion', async () => {
    const request = input();
    let stored: ImportReport | undefined;
    const service = createImportService({
      source: () => source,
      deadlineMs: 10,
      importer: {
        receipt: async () => stored,
        write: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          stored = report(request.requestId);
          return stored;
        },
      },
    });
    expect(await service.startImport('user', request)).toEqual(report(request.requestId));
    expect(await service.cancelImport('user', request.requestId)).toEqual({ cancelled: false });
    expect((await service.importStatus('user', request.requestId)).status).toBe('complete');
  });
  it('deadline cancels a pending network request and allows another preflight', async () => {
    let calls = 0;
    const service = createImportService({
      deadlineMs: 10,
      source: () => ({
        ...source,
        schema: async (_id, _token, signal) => {
          if (calls++ > 0) return schema;
          await new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(Error('network token')), { once: true }),
          );
          return schema;
        },
      }),
      importer: { receipt: async () => undefined, write: vi.fn() },
    });
    await expect(service.preflightImport('user', 'appFixture', 'token')).rejects.toThrow(
      'deadline exceeded',
    );
    expect((await service.preflightImport('user', 'appFixture', 'token')).tables).toHaveLength(1);
  });
  it('cancel waits for commit boundary and does not claim a committed import was cancelled', async () => {
    let entered!: () => void, finish!: () => void, stored: ImportReport | undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const request = input();
    const service = createImportService({
      source: () => source,
      importer: {
        receipt: async () => stored,
        write: async () => {
          entered();
          await release;
          stored = report(request.requestId);
          return stored;
        },
      },
    });
    const running = service.startImport('user', request);
    await ready;
    const cancellation = service.cancelImport('user', request.requestId);
    finish();
    await running;
    expect(await cancellation).toEqual({ cancelled: false });
  });
  it('sanitizes failures and frees slot for the next request', async () => {
    const service = createImportService({
      source: () => source,
      importer: {
        receipt: async () => undefined,
        write: async () => {
          throw Error('postgresql://private-token');
        },
      },
    });
    await expect(service.startImport('user', input())).rejects.toThrow('Import failed');
    await expect(service.startImport('user', input())).rejects.toThrow('Import failed');
  });
});
