// Browser-side ws client for realtime. Single connection, auto-reconnect.
export type ServerMessage =
  | { type: 'change'; baseId: string; tableId?: string }
  | {
      type: 'presence';
      baseId: string;
      users: Array<{ userId: string; userName: string }>;
    };

export interface RealtimeClient {
  /**
   * Open the socket if not already open. Idempotent while connected, and
   * deliberately works again after close()/disconnect() (see teardown).
   */
  connect(): void;
  /**
   * Stop wanting the connection: closes the socket and cancels any pending
   * reconnect. Used when the route stops wanting a connection (anonymous
   * pages). The client stays reusable — a later connect() reopens.
   */
  disconnect(): void;
  subscribe(baseId: string): void;
  unsubscribe(baseId: string): void;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  /**
   * Fired when a socket that had successfully opened before re-opens after a
   * drop (the reconnect loop only replays subscriptions, NOT the broadcasts
   * delivered inside the gap). Listeners should compensate — the provider
   * refetches the queries the gap may have stale-dated. Deliberately NOT
   * fired on the first open of a lifecycle (nothing was missed yet) nor
   * after teardown→connect (a new lifecycle mounts its queries fresh).
   */
  onReconnect(cb: () => void): () => void;
  close(): void;
}

export function createRealtimeClient(url: string): RealtimeClient {
  let ws: WebSocket | null = null;
  const subscriptions = new Set<string>();
  const callbacks = new Set<(msg: ServerMessage) => void>();
  const reconnectCallbacks = new Set<() => void>();
  let reconnectDelay = 500;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // True once a socket opened successfully in the CURRENT wanted lifecycle.
  // Distinguishes "re-open after a drop" (gap may have lost broadcasts →
  // notify) from a lifecycle's first open (nothing missed yet). Reset by
  // teardown alongside the backoff: a fresh connect() starts a new story.
  let hasConnected = false;
  // Whether an owner currently wants the connection. Every close path clears
  // it, so the socket's own onclose can never resurrect a client nobody wants
  // (ghost sockets / endless retry loops after unmount or on anonymous routes).
  // There is deliberately NO terminal "closed" flag: in dev, StrictMode
  // remounting runs the unmount cleanup (provider calls close()) and then the
  // connect() effect again on the SAME client instance — with a terminal flag
  // that second connect() would no-op and realtime would stay dead for the
  // whole dev session. An explicit connect() is the one legitimate way back.
  let wanted = false;

  function openSocket() {
    // The constructor itself can throw synchronously (e.g. a malformed
    // NEXT_PUBLIC_REALTIME_URL). A thrown constructor leaves no socket, so
    // onclose never fires — without scheduling here the retry loop would die
    // silently: wanted stays true with ws=null and no pending timer, and the
    // idempotent connect() can then never revive the client (only a route
    // flip's disconnect()→connect() could). Reuse the onclose backoff; there
    // is no double-scheduling risk because this path has no onclose. The
    // wanted guard mirrors onclose so a teardown that raced in leaves no
    // orphan timer.
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      if (wanted) {
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 10000);
          openSocket();
        }, reconnectDelay);
      }
      return;
    }
    // Capture the socket each handler was installed on: after a
    // disconnect()→connect() switch the OLD socket's close/error events still
    // arrive asynchronously, and without the identity check they would null
    // the NEW socket's ws reference (or, with wanted=true, schedule a
    // reconnect that opens a duplicate live socket → double message delivery).
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      reconnectDelay = 500;
      // A re-open after a live connection means the disconnect gap may have
      // dropped change broadcasts — let subscribers compensate (the provider
      // invalidates queries). The lifecycle's first open stays quiet.
      if (hasConnected) reconnectCallbacks.forEach((cb) => cb());
      hasConnected = true;
      for (const baseId of subscriptions) {
        sock.send(JSON.stringify({ type: 'subscribe', baseId }));
      }
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        callbacks.forEach((cb) => cb(msg));
      } catch {
        // ignore
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (!wanted) return;
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        openSocket();
      }, reconnectDelay);
    };
    sock.onerror = () => {
      if (ws !== sock) return;
      sock.close();
    };
  }

  function connect() {
    if (wanted) return;
    wanted = true;
    openSocket();
  }

  function teardown() {
    wanted = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // A fresh connect() after teardown is a new connection lifecycle — it
    // should not inherit the backoff grown by the previous one (that reset
    // would otherwise only happen after a successful reopen), nor count as a
    // "reconnect" for onReconnect listeners (new lifecycle = fresh queries,
    // no gap to compensate).
    reconnectDelay = 500;
    hasConnected = false;
    ws?.close();
    ws = null;
  }

  return {
    connect,
    // disconnect() and close() are the same operation: stop the retry loop
    // and close the socket, leaving the client reusable (connect() works
    // again — the StrictMode remount sequence depends on that). Two names
    // only keep call-site intent distinct: "route went offline" vs
    // "provider unmounted".
    disconnect: teardown,
    subscribe(baseId) {
      subscriptions.add(baseId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', baseId }));
      }
    },
    unsubscribe(baseId) {
      subscriptions.delete(baseId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe', baseId }));
      }
    },
    onMessage(cb) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    onReconnect(cb) {
      reconnectCallbacks.add(cb);
      return () => reconnectCallbacks.delete(cb);
    },
    close: teardown,
  };
}
