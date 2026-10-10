import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
import { retryDelayMs, startWebhookWorker } from './worker';

afterEach(() => vi.useRealTimers());

it('stops after five total attempts', () => {
  expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([1000, 10000, 60000, 300000, null]);
});

it('serializes ticks, cleans once per minute, and stops without another claim', async () => {
  vi.useFakeTimers();
  const cleanup = vi.fn(async () => {});
  let finish!: () => void;
  const runBatch = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { claimed: 0, succeeded: 0, failed: 0 };
  });
  const worker = startWebhookWorker({ cleanup, runBatch });
  await vi.advanceTimersByTimeAsync(0);
  expect(runBatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(runBatch).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(runBatch).toHaveBeenCalledTimes(2);
  expect(cleanup).toHaveBeenCalledTimes(2);
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(runBatch).toHaveBeenCalledTimes(3);
  expect(cleanup).toHaveBeenCalledTimes(2);
  let stopped = false;
  const stop = worker.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish();
  await stop;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(runBatch).toHaveBeenCalledTimes(3);
});

it('aborts an active batch and waits for its acknowledgement before stop resolves', async () => {
  let finish!: () => void;
  let signal!: AbortSignal;
  const runBatch = vi.fn(async (options?: { signal?: AbortSignal }) => {
    signal = options!.signal!;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { claimed: 1, succeeded: 0, failed: 1 };
  });
  const worker = startWebhookWorker({ cleanup: async () => {}, runBatch });
  await Promise.resolve();
  const stop = worker.stop();
  expect(signal.aborted).toBe(true);
  finish();
  await stop;
});
