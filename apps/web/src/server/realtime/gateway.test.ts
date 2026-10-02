import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

const authMock = vi.hoisted(() => ({
  auth: { api: { getSession: vi.fn() } },
}));
const rolesMock = vi.hoisted(() => ({
  getMembership: vi.fn(),
}));
vi.mock('../auth', () => authMock);
vi.mock('@/lib/roles', () => rolesMock);

import { broadcast, closeAll, closeBaseForUser, handleUpgrade, sweepMemberships } from './gateway';

// Real ws round-trip against a throwaway HTTP server: presence events give an
// externally observable signal for successful subscribes.

let server: Server;
let port: number;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 426;
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  vi.clearAllMocks();
});

// The mocked session is derived from the cookie, so tests can act as
// different users on the same gateway.
authMock.auth.api.getSession.mockImplementation(async ({ headers }: { headers: Headers }) => {
  const cookie = headers.get('cookie') ?? '';
  const userId = cookie.includes('user=u2') ? 'u2' : 'u1';
  return { user: { id: userId, name: userId === 'u1' ? 'Alice' : 'Bob' } };
});
rolesMock.getMembership.mockResolvedValue('viewer');

interface Client {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  opened: Promise<void>;
  closed: Promise<void>;
}

function connect(headers: Record<string, string>): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime`, { headers });
  sockets.push(ws);
  const messages: Array<Record<string, unknown>> = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(String(data)) as Record<string, unknown>);
    } catch {
      // ignore malformed
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  return { ws, messages, opened, closed };
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// waitFor measures its deadline with Date.now, so it deadlocks inside tests
// that freeze the clock for rate-limit pacing: the deadline never arrives and
// a genuine failure surfaces as an opaque test timeout instead of the
// intended error. This variant bounds the wait by iteration count (each round
// a real 25ms sleep), staying under the test's own timeout budget.
async function waitForFrozenClock(cond: () => boolean, maxRounds = 40): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timed out');
}

function subscribe(client: Client, baseId: string): void {
  client.ws.send(JSON.stringify({ type: 'subscribe', baseId }));
}

// The client ws' private socket handle (not in @types/ws' public surface):
// pausing/resuming the underlying TCP stream simulates/undoes a consumer
// that stopped reading.
function rawSocket(ws: WebSocket): { pause(): void; resume(): void } | undefined {
  return (ws as unknown as { _socket?: { pause(): void; resume(): void } })._socket;
}

function presenceBaseIds(client: Client): Set<string> {
  return new Set(
    client.messages
      .filter((m) => m.type === 'presence' && typeof m.baseId === 'string')
      .map((m) => m.baseId as string),
  );
}

describe('realtime gateway — upgrade authorization', () => {
  it('rejects a cross-origin upgrade', async () => {
    const client = connect({ origin: 'http://evil.example', cookie: 'user=u1' });
    await expect(client.opened).rejects.toThrow();
  });

  it('rejects an upgrade without a session (no cookie)', async () => {
    authMock.auth.api.getSession.mockResolvedValueOnce(null);
    const client = connect({ origin: `http://127.0.0.1:${port}` });
    await expect(client.opened).rejects.toThrow();
  });

  it('accepts a same-origin upgrade with a session and serves subscribes', async () => {
    const client = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    await client.opened;
    subscribe(client, 'b-ok');
    await waitFor(() => presenceBaseIds(client).has('b-ok'));
  });
});

describe('realtime gateway — subscribe limits', () => {
  it('rate-limits subscribes to 5 per second per connection', async () => {
    const client = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    await client.opened;
    for (let i = 1; i <= 7; i++) subscribe(client, `b-rate-${i}`);
    await waitFor(() => presenceBaseIds(client).size >= 5);
    await new Promise((r) => setTimeout(r, 300)); // let over-limit messages drain
    expect(presenceBaseIds(client).size).toBe(5);
  }, 10_000);

  it('caps channels at 32 per connection', async () => {
    // Real-clock pacing of the 5/s subscribe limit costs >7s of sleeps here.
    // The gateway runs in-process, so freezing Date.now and advancing it
    // manually between batches gives the sliding window fresh 1s windows
    // without waiting them out.
    let clock = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const client = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
      await client.opened;
      // 5 per (fake) second, paced until past the 32-channel cap.
      for (let batch = 0; batch < 7; batch++) {
        clock += 1100; // next subscribe falls into a fresh sliding window
        for (let i = 0; i < 5; i++) subscribe(client, `b-cap-${batch}-${i}`);
        await waitForFrozenClock(
          () => presenceBaseIds(client).size >= Math.min(5 * (batch + 1), 32),
        );
      }
      expect(presenceBaseIds(client).size).toBeLessThanOrEqual(32);
      expect(presenceBaseIds(client).size).toBeGreaterThanOrEqual(30); // cap, not a failure
    } finally {
      nowSpy.mockRestore();
    }
  }, 2_000);
});

describe('realtime gateway — kick and sweep', () => {
  it('closeBaseForUser kicks only the targeted user off the base', async () => {
    const alice = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    const bob = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u2' });
    await Promise.all([alice.opened, bob.opened]);
    subscribe(alice, 'b-kick');
    subscribe(bob, 'b-kick');
    await waitFor(() => presenceBaseIds(alice).has('b-kick'));

    closeBaseForUser('b-kick', 'u1');
    await alice.closed;
    expect(bob.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('broadcast suppresses the exceptUserId echo', async () => {
    const alice = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    const bob = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u2' });
    await Promise.all([alice.opened, bob.opened]);
    subscribe(alice, 'b-echo');
    subscribe(bob, 'b-echo');
    await waitFor(() => presenceBaseIds(alice).has('b-echo'));

    const before = bob.messages.length;
    broadcast('b-echo', { type: 'change', baseId: 'b-echo' }, 'u1');
    await waitFor(() => bob.messages.length > before);
    const changeAlice = alice.messages.filter((m) => m.type === 'change').length;
    const changeBob = bob.messages.filter((m) => m.type === 'change').length;
    expect(changeBob).toBe(1);
    expect(changeAlice).toBe(0);
  });

  it('membership sweep closes connections whose membership was revoked', async () => {
    const client = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    await client.opened;
    subscribe(client, 'b-sweep');
    await waitFor(() => presenceBaseIds(client).has('b-sweep'));

    rolesMock.getMembership.mockResolvedValue(null);
    await sweepMemberships();
    await client.closed;
  });
});

describe('realtime gateway — shutdown and backpressure', () => {
  // The sweep test above leaves getMembership resolving to null (clearAllMocks
  // clears calls, not implementations) — restore the member default so
  // subscribes in this block authorize again.
  beforeEach(() => {
    rolesMock.getMembership.mockResolvedValue('viewer');
  });

  it('closeAll closes every connected client (graceful shutdown path)', async () => {
    const alice = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
    const bob = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u2' });
    await Promise.all([alice.opened, bob.opened]);
    subscribe(alice, 'b-shutdown');
    subscribe(bob, 'b-shutdown');
    await waitFor(
      () => presenceBaseIds(alice).has('b-shutdown') && presenceBaseIds(bob).has('b-shutdown'),
    );

    closeAll();
    await Promise.all([alice.closed, bob.closed]);
    // Idempotent: a second call on empty state must not throw.
    expect(() => closeAll()).not.toThrow();
  }, 10_000);

  it('broadcast terminates a slow consumer past the buffered-amount cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const alice = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u1' });
      const bob = connect({ origin: `http://127.0.0.1:${port}`, cookie: 'user=u2' });
      await Promise.all([alice.opened, bob.opened]);
      subscribe(alice, 'b-slow');
      subscribe(bob, 'b-slow');
      await waitFor(
        () => presenceBaseIds(alice).has('b-slow') && presenceBaseIds(bob).has('b-slow'),
      );

      // Freeze bob at the TCP layer — a client that stopped reading. Server-side
      // sends then pile into ws' in-memory buffer (bufferedAmount) instead of
      // draining to the network, which is exactly the slow-consumer scenario
      // the cap guards against.
      rawSocket(bob.ws)?.pause();
      const pad = 'x'.repeat(64 * 1024);
      // Paced flood: 512KB bursts with a drain pause between them. The pause
      // keeps healthy alice's server-side buffer near-empty (loopback drains
      // 512KB in far under 10ms — an unpaced 16MB dump would balloon even a
      // healthy reader past the cap), while paused bob's only ever grows,
      // crossing the 4MiB cap after ~8 bursts.
      for (let burst = 0; burst < 64; burst++) {
        for (let i = 0; i < 8; i++) {
          broadcast('b-slow', { type: 'change', baseId: 'b-slow', pad });
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      // A paused socket never reads, so it can't observe the terminate either
      // (the RST sits in the kernel until a read) — resume to make the close
      // observable from the client side.
      rawSocket(bob.ws)?.resume();
      await bob.closed;
      expect(warnSpy).toHaveBeenCalled();
      // Healthy readers on the same channel are unaffected.
      expect(alice.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      warnSpy.mockRestore();
    }
  }, 10_000);
});
