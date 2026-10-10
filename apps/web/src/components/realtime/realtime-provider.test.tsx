// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/bases/b1' }));

// The provider turns ws messages into tRPC invalidations. The mock hands it
// a spy-backed utils, rebuilt fresh per test in beforeEach — presence-only
// tests never touch it, change/reconnect tests assert on the spies.
const mockUtils = vi.hoisted(() => {
  const build = () => ({
    base: { list: { invalidate: vi.fn() } },
    table: { list: { invalidate: vi.fn() } },
    field: { list: { invalidate: vi.fn() } },
    view: { list: { invalidate: vi.fn() } },
    record: {
      get: { invalidate: vi.fn() },
      list: { invalidate: vi.fn() },
      groupCounts: { invalidate: vi.fn() },
      kanbanPage: { invalidate: vi.fn() },
    },
  });
  return { current: build(), build };
});
vi.mock('@/lib/trpc/client', () => ({ trpc: { useUtils: () => mockUtils.current } }));

import { RealtimeProvider, useRealtime } from './realtime-provider';

// Minimal fake: enough for the provider to construct clients and for the test
// to observe socket creation/closure timing (see client.test.ts for the full
// event-controlling variant).
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.OPEN + 2; // CLOSED
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  mockUtils.current = mockUtils.build();
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RealtimeProvider under StrictMode', () => {
  it('survives the dev double-mount: cleanup closes, remount reconnects for real', () => {
    const view = render(
      <StrictMode>
        <RealtimeProvider>
          <div />
        </RealtimeProvider>
      </StrictMode>,
    );

    // StrictMode ran mount effects, then cleanup (provider close()), then the
    // effects again (connect on the SAME client instance) — two sockets total.
    // Pre-fix, the second connect() no-op'd on the terminal closed flag and
    // only one (dead) socket ever existed.
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0]!.readyState).not.toBe(0); // killed by simulated unmount

    // The remounted socket is the live, wanted one: losing it schedules a
    // reconnect, which a dead client never does.
    const sock = FakeWebSocket.instances[1]!;
    sock.readyState = FakeWebSocket.OPEN;
    sock.onopen?.();
    sock.readyState = 3;
    sock.onclose?.();
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
  });

  it('keeps subscribe/unsubscribe identities stable across presence updates', () => {
    const seen: Array<{
      subscribe: unknown;
      unsubscribe: unknown;
      presenceCount: number;
    }> = [];
    function Probe() {
      const rt = useRealtime();
      seen.push({
        subscribe: rt.subscribe,
        unsubscribe: rt.unsubscribe,
        presenceCount: rt.presence.get('b1')?.length ?? 0,
      });
      return null;
    }

    const view = render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    );

    const sock = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    const deliverPresence = (users: Array<{ userId: string; userName: string }>) =>
      act(() => {
        sock.onmessage?.({
          data: JSON.stringify({ type: 'presence', baseId: 'b1', users }),
        });
      });

    deliverPresence([{ userId: 'u1', userName: 'Ann' }]);
    deliverPresence([
      { userId: 'u1', userName: 'Ann' },
      { userId: 'u2', userName: 'Bo' },
    ]);

    // Presence updates re-render consumers (the map is in the context
    // value), but the FUNCTION identities must not change:
    // BaseContextProvider's subscribe effect keys on
    // [baseId, subscribe, unsubscribe], so unstable identities meant every
    // presence frame tore down and re-sent the unsubscribe/subscribe pair.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const entry of seen) {
      expect(entry.subscribe).toBe(seen[0]!.subscribe);
      expect(entry.unsubscribe).toBe(seen[0]!.unsubscribe);
    }
    // Sanity: the presence payloads themselves landed.
    expect(seen[seen.length - 1]!.presenceCount).toBe(2);

    view.unmount();
  });
});

describe('change invalidation', () => {
  const lastSock = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

  function deliverChange(sock: FakeWebSocket, tableId?: string) {
    sock.onmessage?.({
      data: JSON.stringify({ type: 'change', baseId: 'b1', ...(tableId ? { tableId } : {}) }),
    });
  }

  it('debounces a burst of change messages into one invalidation round', () => {
    const view = render(
      <RealtimeProvider>
        <div />
      </RealtimeProvider>,
    );
    const sock = lastSock();

    // A paste-like burst: three broadcasts, two distinct tables, <200ms apart.
    act(() => {
      deliverChange(sock, 't1');
      deliverChange(sock, 't1');
      deliverChange(sock, 't2');
    });

    // Still inside the debounce window: nothing invalidated yet.
    act(() => vi.advanceTimersByTime(199));
    expect(mockUtils.current.field.list.invalidate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    // One round per procedure: each affected table exactly once.
    expect(mockUtils.current.field.list.invalidate).toHaveBeenCalledTimes(2);
    expect(mockUtils.current.field.list.invalidate).toHaveBeenCalledWith({ tableId: 't1' });
    expect(mockUtils.current.field.list.invalidate).toHaveBeenCalledWith({ tableId: 't2' });
    expect(mockUtils.current.view.list.invalidate).toHaveBeenCalledTimes(2);
    expect(mockUtils.current.record.list.invalidate).toHaveBeenCalledTimes(2);
    expect(mockUtils.current.record.get.invalidate).toHaveBeenCalledTimes(2);
    expect(mockUtils.current.record.kanbanPage.invalidate).toHaveBeenCalledTimes(2);
    expect(mockUtils.current.record.kanbanPage.invalidate).toHaveBeenCalledWith({ tableId: 't1' });
    expect(mockUtils.current.base.list.invalidate).not.toHaveBeenCalled();
    expect(mockUtils.current.table.list.invalidate).not.toHaveBeenCalled();

    // A burst after the flush arms a fresh round (timer re-armed, not dead).
    act(() => deliverChange(sock, 't1'));
    act(() => vi.advanceTimersByTime(200));
    expect(mockUtils.current.field.list.invalidate).toHaveBeenCalledTimes(3);

    view.unmount();
  });

  it('a base-scope change (no tableId) escalates the round to base+table only', () => {
    const view = render(
      <RealtimeProvider>
        <div />
      </RealtimeProvider>,
    );
    const sock = lastSock();

    act(() => {
      deliverChange(sock);
      deliverChange(sock);
    });
    act(() => vi.advanceTimersByTime(200));

    expect(mockUtils.current.base.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.table.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.field.list.invalidate).not.toHaveBeenCalled();
    expect(mockUtils.current.view.list.invalidate).not.toHaveBeenCalled();
    expect(mockUtils.current.record.list.invalidate).not.toHaveBeenCalled();
    expect(mockUtils.current.record.get.invalidate).not.toHaveBeenCalled();

    view.unmount();
  });

  it('unmounting before the flush fires no invalidations and leaves no timer', () => {
    const view = render(
      <RealtimeProvider>
        <div />
      </RealtimeProvider>,
    );
    act(() => deliverChange(lastSock(), 't1'));
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(mockUtils.current.field.list.invalidate).not.toHaveBeenCalled();
  });
});

describe('reconnect compensation', () => {
  it('first open invalidates nothing; a re-open after a drop refetches the subscribed scope', () => {
    function SubscribeProbe({ baseId }: { baseId: string }) {
      const rt = useRealtime();
      useEffect(() => {
        rt.subscribe(baseId);
        return () => rt.unsubscribe(baseId);
      }, [rt, baseId]);
      return null;
    }

    const view = render(
      <RealtimeProvider>
        <SubscribeProbe baseId="b1" />
      </RealtimeProvider>,
    );

    const open = (sock: FakeWebSocket) =>
      act(() => {
        sock.readyState = FakeWebSocket.OPEN;
        sock.onopen?.();
      });

    // Initial connect: queries are mounting fresh — no compensation.
    const first = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    open(first);
    expect(mockUtils.current.table.list.invalidate).not.toHaveBeenCalled();

    // Drop, let the reconnect loop re-open (500ms backoff floor).
    act(() => {
      first.readyState = 3;
      first.onclose?.();
    });
    act(() => vi.advanceTimersByTime(500));
    const second = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    expect(second).not.toBe(first);
    open(second);
    // Reconnect compensation is debounced like change invalidation — let the
    // debounce fire before asserting.
    act(() => vi.advanceTimersByTime(250));

    // The gap may have dropped broadcasts: base structure, the SUBSCRIBED
    // base's tables, and the table-scoped lists (active ones refetch).
    expect(mockUtils.current.base.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.table.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.table.list.invalidate).toHaveBeenCalledWith({ baseId: 'b1' });
    expect(mockUtils.current.field.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.view.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.record.list.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.record.get.invalidate).toHaveBeenCalledTimes(1);
    expect(mockUtils.current.record.kanbanPage.invalidate).toHaveBeenCalledTimes(1);

    view.unmount();
  });
});
