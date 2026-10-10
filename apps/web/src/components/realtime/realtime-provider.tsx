'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { usePathname } from 'next/navigation';

import {
  createRealtimeClient,
  type RealtimeClient,
  type ServerMessage,
} from '@/lib/realtime/client';
import { trpc } from '@/lib/trpc/client';

interface PresenceUser {
  userId: string;
  userName: string;
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

// Shared empty identity: a per-call `?? []` would hand every consumer a fresh
// array on each presence frame and chain re-renders through the Topbar even
// on routes without a base.
const NO_PRESENCE: PresenceUser[] = [];

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

// One "this table's data changed" refetch round — shared by the debounced
// change flush and the reconnect compensation below so the two can never
// drift apart in scope.
function invalidateTableData(utils: TrpcUtils, tableId: string): void {
  utils.field.list.invalidate({ tableId });
  utils.view.list.invalidate({ tableId });
  utils.record.list.invalidate({ tableId });
  utils.record.groupCounts.invalidate({ tableId });
  utils.record.kanbanPage.invalidate({ tableId });
}

// Base-level structural change (table/base renamed, created, deleted).
function invalidateBaseStructure(utils: TrpcUtils): void {
  utils.base.list.invalidate();
  utils.table.list.invalidate();
}

// Change events arrive in bursts (one paste = one broadcast per cell) and each
// used to run three invalidates immediately. Debounced here into a single
// refetch round per burst: ~200ms of quiet, re-armed per burst.
const CHANGE_INVALIDATE_DEBOUNCE_MS = 200;

export function usePresence(baseId: string): PresenceUser[] {
  return useRealtime().presence.get(baseId) ?? NO_PRESENCE;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const pathname = usePathname();
  const [presence, setPresence] = useState<Map<string, PresenceUser[]>>(new Map());

  // Create the ws client synchronously on first browser render (ref init), so
  // children's useEffect can call subscribe BEFORE this provider's useEffect
  // runs (React runs child effects first) — subscriptions are replayed on
  // open, so ordering is safe either way. The client does NOT connect by
  // itself; the effect below owns connection lifetime.
  const clientRef = useRef<RealtimeClient | null>(null);
  if (!clientRef.current && typeof window !== 'undefined') {
    // In dev the gateway runs as a separate process on its own port
    // (NEXT_PUBLIC_REALTIME_URL); in prod it's same-origin /realtime.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url =
      process.env.NEXT_PUBLIC_REALTIME_URL ?? `${protocol}//${window.location.host}/realtime`;
    clientRef.current = createRealtimeClient(url);
  }

  // The gateway handshake requires an authenticated session. Anonymous routes
  // (/share, /invite, /login, /register, the landing page) would be rejected
  // and then retried forever on the backoff loop. Every realtime consumer
  // (presence, change invalidation) lives under /bases, so connect only
  // there — an allowlist, so future anonymous routes stay offline by default.
  // disconnect() keeps the client reusable: a later connect() reopens when
  // the user navigates back into /bases.
  const realtimeRoute = pathname != null && pathname.startsWith('/bases');
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    if (realtimeRoute) client.connect();
    else client.disconnect();
  }, [realtimeRoute]);

  // Register message handler once utils is available.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTableIds = new Set<string>();
    let pendingBaseScope = false;

    function flush() {
      flushTimer = null;
      const tableIds = pendingTableIds;
      const baseScope = pendingBaseScope;
      pendingTableIds = new Set();
      pendingBaseScope = false;
      // Scope invalidation to what actually changed — a table edit must not
      // refetch every table's data in the app. A base-scope change (no
      // tableId) escalates the whole round: it may have renamed/created/
      // deleted tables anywhere in the base.
      if (baseScope) invalidateBaseStructure(utils);
      for (const tableId of tableIds) {
        invalidateTableData(utils, tableId);
      }
    }

    const offMessage = client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'change') {
        if (msg.tableId) pendingTableIds.add(msg.tableId);
        else pendingBaseScope = true;
        if (flushTimer == null) {
          flushTimer = setTimeout(flush, CHANGE_INVALIDATE_DEBOUNCE_MS);
        }
      } else if (msg.type === 'presence') {
        setPresence((prev) => {
          const next = new Map(prev);
          next.set(msg.baseId, msg.users);
          return next;
        });
      }
    });

    // Reconnect compensation: the reconnect loop only replays subscriptions,
    // so broadcasts delivered inside the disconnect gap are gone. Refetch
    // what this session actually looks at — the subscribed bases' structure
    // (table.list is keyed by baseId, which only the subscribers know) and
    // every table-scoped query; the no-filter invalidations only hit the
    // network for ACTIVE queries, which on a /bases route is exactly the
    // visible table. Debounced like the change path: a flapping connection
    // fires many reconnects in quick succession.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const offReconnect = client.onReconnect(() => {
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (subscribedBasesRef.current.size > 0) {
          utils.base.list.invalidate();
          for (const baseId of subscribedBasesRef.current) {
            utils.table.list.invalidate({ baseId });
          }
        }
        utils.field.list.invalidate();
        utils.view.list.invalidate();
        utils.record.list.invalidate();
        utils.record.groupCounts.invalidate();
        utils.record.kanbanPage.invalidate();
      }, CHANGE_INVALIDATE_DEBOUNCE_MS);
    });

    return () => {
      offMessage();
      offReconnect();
      if (flushTimer != null) clearTimeout(flushTimer);
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
    };
  }, [utils]);

  // Close on unmount and drop stale presence state. clientRef.current is
  // deliberately NOT nulled here: a real unmount destroys the component
  // instance (refs with it), so the next mount starts from a null ref anyway;
  // but in dev StrictMode the simulated remount re-runs the effects above
  // WITHOUT a re-render, so the render-time ref init does not re-create the
  // client — a nulled ref would leave the reconnect effect with nothing to
  // connect and realtime would stay dead until a route flip re-rendered.
  // close() is safe in that cleanup precisely because it is not terminal:
  // the remounted effect re-calls connect() on the same instance.
  useEffect(
    () => () => {
      clientRef.current?.close();
      setPresence(new Map());
    },
    [],
  );

  // Stable identities across presence updates: consumers like BaseContext
  // key their subscribe effect on these functions ([baseId, subscribe,
  // unsubscribe]). When they were inlined in the value memo, every presence
  // message re-created them and the effect re-ran — re-sending an
  // unsubscribe/subscribe frame pair per presence update. They only touch
  // refs (client + the mirror below), so an empty dep array is correct.
  // The mirror of currently-subscribed bases exists for reconnect
  // compensation: the ws layer knows the set too, but only here can it be
  // turned into base-scoped table.list invalidations.
  const subscribedBasesRef = useRef<Set<string>>(new Set());
  const subscribe = useCallback((baseId: string) => {
    subscribedBasesRef.current.add(baseId);
    clientRef.current?.subscribe(baseId);
  }, []);
  const unsubscribe = useCallback((baseId: string) => {
    subscribedBasesRef.current.delete(baseId);
    clientRef.current?.unsubscribe(baseId);
  }, []);

  const value = useMemo<RealtimeContext>(
    () => ({ subscribe, unsubscribe, presence }),
    [subscribe, unsubscribe, presence],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
