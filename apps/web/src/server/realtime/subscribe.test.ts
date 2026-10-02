import { beforeEach, describe, expect, it, vi } from 'vitest';

// subscribe.ts wires three collaborators; all mocked so the real gateway/auth
// stack never loads. sql.listen captures the (channel, onnotify, onlisten)
// triple postgres.js would invoke.
const listenMock = vi.hoisted(() => vi.fn());
const gatewayMock = vi.hoisted(() => ({
  broadcast: vi.fn(),
  closeBaseForUser: vi.fn(),
  rebroadcastAllChannels: vi.fn(),
}));
vi.mock('../db', () => ({ sql: { listen: listenMock } }));
vi.mock('./gateway', () => gatewayMock);
vi.mock('./publish', () => ({ REALTIME_CHANNEL: 'markpocket_realtime' }));

// Module-level `started` flag: each test needs a fresh subscribe module.
beforeEach(() => {
  vi.resetModules();
  listenMock.mockReset().mockResolvedValue(undefined);
  gatewayMock.broadcast.mockClear();
  gatewayMock.closeBaseForUser.mockClear();
  gatewayMock.rebroadcastAllChannels.mockClear();
});

function start(): Promise<void> {
  return import('./subscribe').then((m) => m.startRealtimeSubscription());
}

function capturedHandlers(): {
  channel: string;
  onnotify: (payload: string) => void;
  onlisten: () => void;
} {
  expect(listenMock).toHaveBeenCalled();
  const [channel, onnotify, onlisten] = listenMock.mock.calls[0] as unknown as [
    string,
    (payload: string) => void,
    () => void,
  ];
  return { channel, onnotify, onlisten };
}

describe('startRealtimeSubscription', () => {
  it('listens on the realtime channel exactly once per process', async () => {
    await start();
    await start(); // second call hits the started guard
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(capturedHandlers().channel).toBe('markpocket_realtime');
  });

  it('forwards a table-scoped change notice to broadcast', async () => {
    await start();
    capturedHandlers().onnotify(
      JSON.stringify({ baseId: 'b1', tableId: 't1', exceptUserId: 'u3' }),
    );
    expect(gatewayMock.broadcast).toHaveBeenCalledWith(
      'b1',
      { type: 'change', baseId: 'b1', tableId: 't1' },
      'u3',
    );
  });

  it('forwards a base-scoped change notice (no tableId)', async () => {
    await start();
    capturedHandlers().onnotify(JSON.stringify({ baseId: 'b2' }));
    expect(gatewayMock.broadcast).toHaveBeenCalledWith(
      'b2',
      { type: 'change', baseId: 'b2' },
      undefined,
    );
  });

  it('routes a kick notice to closeBaseForUser instead of broadcast', async () => {
    await start();
    capturedHandlers().onnotify(JSON.stringify({ baseId: 'b3', kick: { userId: 'u9' } }));
    expect(gatewayMock.closeBaseForUser).toHaveBeenCalledWith('b3', 'u9');
    expect(gatewayMock.broadcast).not.toHaveBeenCalled();
  });

  it('drops malformed payloads silently', async () => {
    await start();
    capturedHandlers().onnotify('not json {');
    expect(gatewayMock.broadcast).not.toHaveBeenCalled();
    expect(gatewayMock.closeBaseForUser).not.toHaveBeenCalled();
  });

  it('first LISTEN does not rebroadcast; each reconnect does', async () => {
    await start();
    const { onlisten } = capturedHandlers();
    expect(typeof onlisten).toBe('function');
    // Initial connection — nothing was missed, nothing to reconcile.
    onlisten();
    expect(gatewayMock.rebroadcastAllChannels).not.toHaveBeenCalled();
    // postgres.js re-listen after a connection drop — the gap dropped
    // notices, so every channel must be nudged to refetch.
    onlisten();
    expect(gatewayMock.rebroadcastAllChannels).toHaveBeenCalledTimes(1);
    onlisten();
    expect(gatewayMock.rebroadcastAllChannels).toHaveBeenCalledTimes(2);
  });

  it('retries the initial LISTEN with backoff, and that success is still a first connect', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    listenMock.mockRejectedValueOnce(new Error('db not up yet'));
    try {
      await start(); // fails, schedules a retry
      expect(listenMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000); // RETRY_DELAY_START_MS
      expect(listenMock).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith('> realtime pg subscription ready');
      // The successful retry is the FIRST-ever connection — no rebroadcast.
      const [, , onlisten] = listenMock.mock.calls[1] as unknown as [string, unknown, () => void];
      onlisten();
      expect(gatewayMock.rebroadcastAllChannels).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
