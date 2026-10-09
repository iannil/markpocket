import { randomUUID } from 'node:crypto';
import { createAirtableSource } from './client';
import { createImporter, type Importer } from './importer';
import { RECOVERY_HINT } from './journal';
import { preflight } from './mapping';
import { checkSignal, prepareImport } from './prepare';
import {
  AirtableImportError,
  type AirtableSource,
  type ImportInput,
  type ImportProgress,
  type ImportReport,
  type Preflight,
} from './types';

type Active = {
  requestId: string;
  userId: string;
  controller: AbortController;
  progress: ImportProgress;
  done: Promise<void>;
  finish(): void;
};
export type ImportStatus =
  | { status: 'running'; progress: ImportProgress }
  | { status: 'complete'; report: ImportReport }
  | { status: 'not-running' };
function safeError(error: unknown, signal?: AbortSignal): Error {
  if (
    error instanceof Error &&
    (error.message === RECOVERY_HINT || error.message === 'Access denied')
  )
    return Error(error.message);
  if (signal?.aborted)
    return new AirtableImportError('cancelled', 'Import cancelled or deadline exceeded');
  if (error instanceof AirtableImportError) return error;
  return Error('Import failed; retry with the same request ID');
}
export function createImportService(
  dependencies: { source?: () => AirtableSource; importer?: Importer; deadlineMs?: number } = {},
) {
  const importer = dependencies.importer ?? createImporter();
  const source = dependencies.source ?? (() => createAirtableSource());
  let active: Active | undefined;
  function claim(userId: string, requestId: string) {
    if (active) throw new AirtableImportError('limit', 'Another import or preflight is running');
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const slot: Active = {
      userId,
      requestId,
      controller: new AbortController(),
      progress: { phase: 'schema', records: 0, attachments: 0 },
      done,
      finish,
    };
    active = slot;
    const deadlineAt = Date.now() + (dependencies.deadlineMs ?? 120000);
    const timer = setTimeout(() => slot.controller.abort(), Math.max(1, deadlineAt - Date.now()));
    return {
      slot,
      deadlineAt,
      release() {
        clearTimeout(timer);
        if (active === slot) active = undefined;
        finish();
      },
    };
  }
  async function receipt(userId: string, requestId: string) {
    try {
      return await importer.receipt(userId, requestId);
    } catch (error) {
      throw safeError(error);
    }
  }
  return {
    async preflightImport(userId: string, sourceBaseId: string, token: string): Promise<Preflight> {
      const operation = claim(userId, randomUUID());
      try {
        const result = preflight(
          await source().schema(sourceBaseId, token, operation.slot.controller.signal),
          sourceBaseId,
        );
        checkSignal(operation.slot.controller.signal);
        return result;
      } catch (error) {
        throw safeError(error, operation.slot.controller.signal);
      } finally {
        operation.release();
      }
    },
    async startImport(userId: string, input: ImportInput): Promise<ImportReport> {
      const existing = await receipt(userId, input.requestId);
      if (existing) return existing;
      // Concurrent same-user retries wait for the active attempt, then use its
      // durable receipt. The active state contains no source or credentials.
      if (active?.requestId === input.requestId) {
        if (active.userId !== userId) throw Error('Access denied');
        await active.done;
        const completed = await receipt(userId, input.requestId);
        if (completed) return completed;
      }
      const operation = claim(userId, input.requestId);
      const signal = operation.slot.controller.signal;
      try {
        const prepared = await prepareImport(source(), input, signal, operation.slot.progress);
        operation.slot.progress.phase = 'writing';
        return await importer.write(userId, input, prepared, signal, operation.deadlineAt);
      } catch (error) {
        throw safeError(error, signal);
      } finally {
        operation.release();
      }
    },
    async importStatus(userId: string, requestId: string): Promise<ImportStatus> {
      const completed = await receipt(userId, requestId);
      if (completed) return { status: 'complete', report: completed };
      if (active?.requestId === requestId) {
        if (active.userId !== userId) throw Error('Access denied');
        return { status: 'running', progress: { ...active.progress } };
      }
      return { status: 'not-running' };
    },
    async cancelImport(userId: string, requestId: string): Promise<{ cancelled: boolean }> {
      if (await receipt(userId, requestId)) return { cancelled: false };
      if (active?.requestId === requestId) {
        if (active.userId !== userId) throw Error('Access denied');
        const cancelling = active;
        cancelling.controller.abort();
        await cancelling.done;
        return { cancelled: !(await receipt(userId, requestId)) };
      }
      return { cancelled: false };
    },
  };
}
const service = createImportService();
export const { preflightImport, startImport, importStatus, cancelImport } = service;
