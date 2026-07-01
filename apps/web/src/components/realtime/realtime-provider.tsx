'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  createRealtimeClient,
  type RealtimeClient,
  type ServerMessage,
} from '@/lib/realtime/client';
import { trpc } from '@/lib/trpc/client';

interface PresenceUser {
  userId: string;
  userName: string;
  userEmail: string;
}

interface RealtimeContext {
  subscribe: (baseId: string) => void;
  unsubscribe: (baseId: string) => void;
  presence: Map<string, PresenceUser[]>;
}

const Ctx = createContext<RealtimeContext | null>(null);

export function useRealtime(): RealtimeContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRealtime must be inside <RealtimeProvider>');
  return ctx;
}

export function usePresence(baseId: string): PresenceUser[] {
  return useRealtime().presence.get(baseId) ?? [];
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const [presence, setPresence] = useState<Map<string, PresenceUser[]>>(new Map());

  // Create the ws client synchronously on first browser render (ref init), so
  // children's useEffect can call subscribe BEFORE this provider's useEffect runs
  // (React runs child effects first).
  const clientRef = useRef<RealtimeClient | null>(null);
  if (!clientRef.current && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    clientRef.current = createRealtimeClient(`${protocol}//${window.location.host}/realtime`);
  }

  // Register message handler once utils is available.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    return client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'change') {
        if (msg.tableId) {
          utils.field.list.invalidate({ tableId: msg.tableId });
          utils.view.list.invalidate({ tableId: msg.tableId });
        }
        utils.record.list.invalidate();
        utils.base.list.invalidate();
      } else if (msg.type === 'presence') {
        setPresence((prev) => {
          const next = new Map(prev);
          next.set(msg.baseId, msg.users);
          return next;
        });
      }
    });
  }, [utils]);

  // Close on unmount.
  useEffect(() => () => clientRef.current?.close(), []);

  const value = useMemo<RealtimeContext>(
    () => ({
      subscribe: (baseId: string) => clientRef.current?.subscribe(baseId),
      unsubscribe: (baseId: string) => clientRef.current?.unsubscribe(baseId),
      presence,
    }),
    [presence],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
