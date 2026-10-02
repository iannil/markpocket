// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealtimeClient, type ServerMessage } from './client';

// jsdom does not implement WebSocket, so every test installs this fake on
// globalThis (vi.stubGlobal restores whatever was there). close() only marks
// the state — network events are delivered via the explicit server* helpers,
// which lets tests decide WHEN a close event lands. That timing is the whole
// point: the races being regression-tested live between "client called
// close()" and "the socket's close event arrives on a later task".
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    // Real browsers throw InvalidStateError on send() while the socket is not
    // OPEN. Mirroring that gives the client's readyState guards real teeth:
    // if a guard regresses, tests fail on the throw instead of silently
    // recording a frame that would never have gone out.
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException('WebSocket is not in the OPEN state', 'InvalidStateError');
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test-side event helpers.
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  serverError(): void {
    this.onerror?.();
  }
  serverMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

// A WebSocket replacement whose constructor always throws — models a bad env
// URL, where `new WebSocket(url)` fails synchronously and no socket (hence no
// onclose) ever exists. Kept separate from FakeWebSocket so its failures
// don't pollute the instance log.
class ThrowingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  constructor(_url: string) {
    throw new Error('invalid WebSocket URL');
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('realtime client state machine', () => {
  it('connect→close→connect (StrictMode remount) ends with a live, wanted connection', () => {
    const client = createRealtimeClient('ws://test/realtime');

    // StrictMode remount sequence on one provider instance: mount connects,
    // the simulated unmount runs the close() cleanup, remount connects again.
    client.connect();
    client.close();
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(2);
    const sock = lastSocket();
    expect(sock.readyState).toBe(FakeWebSocket.CONNECTING);

    // Live: the remounted socket opens and carries subscriptions.
    client.subscribe('b1');
    sock.serverOpen();
    expect(sock.sent).toEqual([JSON.stringify({ type: 'subscribe', baseId: 'b1' })]);

    // Wanted: losing it schedules a reconnect. (Pre-fix, the second connect()
    // no-op'd on a permanent closed flag and nothing ever reconnected.)
    sock.serverClose();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('a stale socket close event after disconnect→connect cannot kill the new connection', () => {
    const client = createRealtimeClient('ws://test/realtime');
    const received: ServerMessage[] = [];
    client.onMessage((m) => received.push(m));

    client.connect();
    const first = lastSocket();
    first.serverOpen();

    client.disconnect(); // closes `first` synchronously...
    client.connect(); // ...whose close EVENT only arrives after the new socket exists
    const second = lastSocket();
    second.serverOpen();
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The old socket's late close event must be ignored: no ws=null clobber
    // and no reconnect timer (which would open a duplicate live socket).
    first.serverClose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The new connection still works end to end.
    second.serverMessage({ type: 'change', baseId: 'b1', tableId: 't1' });
    expect(received).toEqual([{ type: 'change', baseId: 'b1', tableId: 't1' }]);
  });

  it('after close(), the socket close event does not resurrect the client', () => {
    const client = createRealtimeClient('ws://test/realtime');
    client.connect();
    const sock = lastSocket();
    sock.serverOpen();

    client.close();
    sock.serverClose(); // network-level close confirmation arrives late

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnect backoff stops once nobody wants the connection', () => {
    const client = createRealtimeClient('ws://test/realtime');
    client.connect();
    lastSocket().serverOpen();

    // Wanted: each drop schedules exactly one reconnect.
    lastSocket().serverClose();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().serverClose(); // still wanted → next backoff timer (1s now)
    expect(vi.getTimerCount()).toBe(1);

    // Unwanted mid-backoff: the pending reconnect is cancelled.
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // And a close event arriving while unwanted schedules nothing either.
    client.connect();
    const third = lastSocket();
    client.disconnect();
    third.serverClose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('teardown resets reconnect backoff: a new lifecycle starts at the 500ms floor', () => {
    const client = createRealtimeClient('ws://test/realtime');
    client.connect();
    lastSocket().serverOpen();

    // Grow the backoff 500→1s→2s→4s→8s→10s and confirm the 10s cap holds
    // (the 7th wait is again 10s, not 20s). Each wait is checked at the
    // boundary: one ms before the delay nothing has fired yet.
    const delays = [500, 1000, 2000, 4000, 8000, 10000, 10000];
    for (const [i, delay] of delays.entries()) {
      lastSocket().serverClose();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
    }
    expect(FakeWebSocket.instances).toHaveLength(8);

    // Teardown mid-backoff, then a fresh connect. The new socket stays
    // CONNECTING on purpose: onopen would reset the delay by itself, and the
    // point here is that the FIRST reconnect delay comes from teardown's
    // reset, not from a successful open.
    client.close();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(9);
    lastSocket().serverClose();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(10);
  });

  it('a stale socket error event after disconnect→connect cannot kill the new connection', () => {
    const client = createRealtimeClient('ws://test/realtime');
    const received: ServerMessage[] = [];
    client.onMessage((m) => received.push(m));

    client.connect();
    const first = lastSocket();
    first.serverOpen();

    client.disconnect();
    client.connect();
    const second = lastSocket();
    second.serverOpen();

    // The old socket delivers its dying error→close pair late. Without the
    // identity guard the close would null the new socket's ws reference and
    // arm a reconnect that opens a duplicate live socket.
    first.serverError();
    first.serverClose();
    expect(second.readyState).toBe(FakeWebSocket.OPEN);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The new connection still works end to end.
    second.serverMessage({ type: 'presence', baseId: 'b1', users: [] });
    expect(received).toEqual([{ type: 'presence', baseId: 'b1', users: [] }]);
  });

  it('an error→close cascade schedules exactly one reconnect', () => {
    const client = createRealtimeClient('ws://test/realtime');
    client.connect();
    const sock = lastSocket();
    sock.serverOpen();

    // Browsers deliver error then close for a dropped connection. The
    // client's onerror closes the socket; the close event then arms ONE
    // reconnect timer — the error itself must not schedule a second one
    // (that would open a duplicate live socket after reconnect).
    sock.serverError();
    expect(sock.readyState).toBe(FakeWebSocket.CLOSED);
    sock.serverClose();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a throwing WebSocket constructor on the first connect does not strand the client', () => {
    vi.stubGlobal('WebSocket', ThrowingWebSocket);
    const client = createRealtimeClient('ws://test/realtime');

    // connect() runs inside an effect: the constructor throw must not
    // escape it.
    expect(() => client.connect()).not.toThrow();

    // No socket exists, hence no onclose — the retry loop must be armed
    // anyway (pre-fix: wanted=true, ws=null, no timer → dead until a route
    // flip).
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(vi.getTimerCount()).toBe(1); // still failing → next backoff step
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(1);

    // Recovery once the URL is fixed — no route flip needed: the loop's own
    // next attempt gets a working socket and the client goes live.
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const sock = lastSocket();
    sock.serverOpen();
    client.subscribe('b2');
    expect(sock.sent).toEqual([JSON.stringify({ type: 'subscribe', baseId: 'b2' })]);

    // And connect() while the loop owns recovery stays an idempotent no-op,
    // not a second socket.
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a throwing WebSocket constructor during a reconnect keeps the loop alive', () => {
    const client = createRealtimeClient('ws://test/realtime');
    client.connect();
    lastSocket().serverOpen();
    lastSocket().serverClose(); // arms the 500ms reconnect

    // The reconnect attempt itself throws (bad URL). The timer callback
    // must contain the throw and arm the next backoff step itself — there
    // is no onclose to do it.
    vi.stubGlobal('WebSocket', ThrowingWebSocket);
    vi.advanceTimersByTime(500);
    expect(vi.getTimerCount()).toBe(1);

    // Teardown mid-throw-storm still cancels the pending retry: no zombie
    // loop after unmount.
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // The client is not stuck: a later connect() opens a working socket.
    vi.stubGlobal('WebSocket', FakeWebSocket);
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().serverOpen();
    client.subscribe('b3');
    expect(lastSocket().sent).toEqual([JSON.stringify({ type: 'subscribe', baseId: 'b3' })]);
  });

  it('onReconnect fires only when a live connection re-opens — never on first open nor after teardown', () => {
    const client = createRealtimeClient('ws://test/realtime');
    let reconnects = 0;
    const off = client.onReconnect(() => {
      reconnects += 1;
    });

    // Lifecycle's first open: nothing was missed, no compensation event.
    client.connect();
    lastSocket().serverOpen();
    expect(reconnects).toBe(0);

    // Drop + reopen: the gap may have lost broadcasts — exactly one event.
    lastSocket().serverClose();
    vi.advanceTimersByTime(500);
    lastSocket().serverOpen();
    expect(reconnects).toBe(1);

    // teardown→connect starts a NEW lifecycle (queries remount fresh), so
    // its first open must not count as a reconnect.
    client.close();
    client.connect();
    lastSocket().serverOpen();
    expect(reconnects).toBe(1);

    // And the unsubscribe callback stops delivery on later re-opens.
    off();
    lastSocket().serverClose();
    vi.advanceTimersByTime(500);
    lastSocket().serverOpen();
    expect(reconnects).toBe(1);
  });
});
