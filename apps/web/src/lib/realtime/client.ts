// Browser-side ws client for realtime. Single connection, auto-reconnect.
export type ServerMessage =
  | { type: 'change'; baseId: string; tableId?: string }
  | {
      type: 'presence';
      baseId: string;
      users: Array<{ userId: string; userName: string }>;
    };

export interface RealtimeClient {
  subscribe(baseId: string): void;
  unsubscribe(baseId: string): void;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  close(): void;
}

export function createRealtimeClient(url: string): RealtimeClient {
  let ws: WebSocket | null = null;
  const subscriptions = new Set<string>();
  const callbacks = new Set<(msg: ServerMessage) => void>();
  let reconnectDelay = 500;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by close(): the socket's own onclose must NOT schedule a reconnect,
  // or a "closed" client resurrects forever (ghost sockets after unmount).
  let closed = false;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectDelay = 500;
      for (const baseId of subscriptions) {
        ws?.send(JSON.stringify({ type: 'subscribe', baseId }));
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        callbacks.forEach((cb) => cb(msg));
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        connect();
      }, reconnectDelay);
    };
    ws.onerror = () => ws?.close();
  }

  connect();

  return {
    subscribe(baseId: string) {
      subscriptions.add(baseId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', baseId }));
      }
    },
    unsubscribe(baseId: string) {
      subscriptions.delete(baseId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe', baseId }));
      }
    },
    onMessage(cb) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
