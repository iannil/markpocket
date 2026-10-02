import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { auth } from '../auth';
import { getMembership } from '@/lib/roles';

interface UserMeta {
  userId: string;
  userName: string;
}
interface ClientMeta extends UserMeta {
  baseIds: Set<string>;
  isAlive: boolean;
  // Subscribe-message rate limiting (epoch ms timestamps).
  subscribeTimes: number[];
}

// Cap per-connection channel subscriptions — a hostile client must not be able
// to grow unbounded state server-side.
const MAX_CHANNELS_PER_CLIENT = 32;
// A subscribe flood must not turn into unbounded membership lookups.
const MAX_SUBSCRIBES_PER_SECOND = 5;
const HEARTBEAT_MS = 30_000;
// Subscription authorization is TOCTOU: membership can be revoked while a
// connection stays open. Kicks close the common path fast; this sweep closes
// the rest (missed kick, gateway restart, cross-process races).
const MEMBERSHIP_SWEEP_MS = 5 * 60_000;
// Slow-consumer backpressure cap: a client that stops reading makes ws queue
// outgoing frames in server memory without bound (bufferedAmount only grows).
// Past this threshold the connection is hostile or wedged — terminate it
// instead of letting one slow reader balloon the heap. The heartbeat would
// eventually catch a fully-dead peer, but only after its own timeout, and it
// never catches a deliberately slow one that still answers pings.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, ClientMeta>();
const channels = new Map<string, Set<WebSocket>>(); // baseId -> connections

export function getGateway(): WebSocketServer {
  if (!wss) {
    // 1MiB receive cap: every legit message (subscribe/unsubscribe) is tiny;
    // ws' default 100MiB would let a hostile client buffer huge frames in
    // server memory before the JSON.parse discard.
    wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
    startHeartbeat();
    startMembershipSweep();
    console.log('> realtime ws gateway ready');
  }
  return wss;
}

// Ping/pong heartbeat: flags half-open TCP connections and terminates them
// instead of leaking entries in `clients`/`channels` until OS timeout.
function startHeartbeat(): void {
  const timer = setInterval(() => {
    for (const [ws, meta] of clients) {
      if (meta.isAlive === false) {
        ws.terminate();
        continue;
      }
      meta.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  // Don't hold the process open just for the heartbeat.
  timer.unref?.();
}

function headersFromReq(req: IncomingMessage): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value != null) h.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return h;
}

// Cross-site WebSocket hijacking guard: if the client declares an Origin, it
// must point back at the Host being served (cookie-auth rides along otherwise).
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  try {
    const originHost = new URL(origin).host;
    return originHost.length > 0 && originHost === req.headers.host;
  } catch {
    return false;
  }
}

// Authenticate via the upgrade request's cookie, then accept the ws upgrade.
export async function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  if (!originAllowed(req)) {
    socket.destroy();
    return;
  }
  let session;
  try {
    session = await auth.api.getSession({ headers: headersFromReq(req) });
  } catch {
    session = null;
  }
  if (!session) {
    socket.destroy();
    return;
  }
  getGateway().handleUpgrade(req, socket, head, (ws) => {
    onConnect(ws, {
      userId: session.user.id,
      userName: session.user.name ?? '',
    });
  });
}

function onConnect(ws: WebSocket, user: UserMeta) {
  const meta: ClientMeta = { ...user, baseIds: new Set(), isAlive: true, subscribeTimes: [] };
  clients.set(ws, meta);
  ws.on('pong', () => {
    meta.isAlive = true;
  });
  ws.on('message', (data) => void onMessage(ws, meta, data));
  ws.on('close', () => onClose(ws, meta));
  ws.on('error', () => onClose(ws, meta));
}

// Sliding 1s window; over-limit subscribes are dropped silently.
function allowSubscribe(meta: ClientMeta): boolean {
  const now = Date.now();
  meta.subscribeTimes = meta.subscribeTimes.filter((t) => now - t < 1000);
  if (meta.subscribeTimes.length >= MAX_SUBSCRIBES_PER_SECOND) return false;
  meta.subscribeTimes.push(now);
  return true;
}

async function onMessage(ws: WebSocket, meta: ClientMeta, data: unknown) {
  let msg: { type?: string; baseId?: string };
  try {
    msg = JSON.parse(typeof data === 'string' ? data : (data as Buffer).toString());
  } catch {
    return;
  }
  if (msg.type === 'subscribe' && msg.baseId) {
    if (meta.baseIds.has(msg.baseId)) return;
    if (!allowSubscribe(meta)) return;
    // Channel authorization: only members of the base may join its channel.
    const role = await getMembership(msg.baseId, meta.userId).catch(() => null);
    if (!role) return;
    if (meta.baseIds.size >= MAX_CHANNELS_PER_CLIENT) return;
    meta.baseIds.add(msg.baseId);
    const chan = channels.get(msg.baseId) ?? new Set<WebSocket>();
    chan.add(ws);
    channels.set(msg.baseId, chan);
    broadcastPresence(msg.baseId);
  } else if (msg.type === 'unsubscribe' && msg.baseId) {
    leaveChannel(ws, meta, msg.baseId);
  }
}

function leaveChannel(ws: WebSocket, meta: ClientMeta, baseId: string) {
  const chan = channels.get(baseId);
  if (chan) {
    chan.delete(ws);
    if (chan.size === 0) channels.delete(baseId);
  }
  meta.baseIds.delete(baseId);
  if (channels.has(baseId)) broadcastPresence(baseId);
}

function onClose(ws: WebSocket, meta: ClientMeta) {
  clients.delete(ws);
  for (const baseId of meta.baseIds) {
    const chan = channels.get(baseId);
    if (chan) {
      chan.delete(ws);
      if (chan.size === 0) channels.delete(baseId);
    }
    if (channels.has(baseId)) broadcastPresence(baseId);
  }
}

// Drop every subscription `userId` holds on `baseId` (kick control event from
// member.remove / member.updateRole). Channel bookkeeping is cleaned up here;
// the ws 'close' handler runs afterwards and its cleanup is idempotent.
export function closeBaseForUser(baseId: string, userId: string): void {
  const chan = channels.get(baseId);
  if (!chan) return;
  for (const ws of [...chan]) {
    const meta = clients.get(ws);
    if (!meta || meta.userId !== userId) continue;
    chan.delete(ws);
    meta.baseIds.delete(baseId);
    ws.close();
  }
  if (chan.size === 0) channels.delete(baseId);
  if (channels.has(baseId)) broadcastPresence(baseId);
}

// Periodic membership re-verification for open subscriptions.
export async function sweepMemberships(): Promise<void> {
  for (const [ws, meta] of clients) {
    for (const baseId of meta.baseIds) {
      let role: string | null;
      try {
        role = await getMembership(baseId, meta.userId);
      } catch (err) {
        // Transient DB errors must not mass-disconnect clients.
        console.error('membership sweep lookup failed', err);
        continue;
      }
      if (!role) {
        // Membership revoked: close the whole connection; the client may
        // reconnect and re-subscribe only to bases it still belongs to.
        ws.terminate();
        onClose(ws, meta);
        break;
      }
    }
  }
}

function startMembershipSweep(): void {
  const timer = setInterval(() => void sweepMemberships(), MEMBERSHIP_SWEEP_MS);
  timer.unref?.();
}

export function broadcast<T extends object>(baseId: string, event: T, exceptUserId?: string): void {
  const chan = channels.get(baseId);
  if (!chan) return;
  const json = JSON.stringify(event);
  for (const ws of chan) {
    const m = clients.get(ws);
    if (!m || m.userId === exceptUserId) continue;
    if (ws.readyState !== ws.OPEN) continue;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      console.warn(
        `realtime: terminating slow consumer on base ${baseId} ` +
          `(userId=${m.userId}, buffered=${ws.bufferedAmount}B > ${MAX_BUFFERED_BYTES}B)`,
      );
      ws.terminate();
      continue;
    }
    ws.send(json);
  }
}

// LISTEN reconnection gap-filler (called by subscribe.ts): while the Postgres
// subscription was down, notifications were silently dropped — postgres.js
// re-runs LISTEN on reconnect but pg does not replay anything sent in the
// gap, so every connected client may be holding stale data with no signal
// ever coming. Re-broadcast one synthetic base-scoped change per active
// channel so clients refetch. Base-scoped (no tableId) on purpose: the missed
// notices could touch any table in the base, and clients treat a base-wide
// change as "pull everything in this base". Snapshot the keys first —
// terminate() inside broadcast schedules channel cleanup via 'close', and
// future-proofing against mutation during iteration costs nothing.
export function rebroadcastAllChannels(): void {
  for (const baseId of [...channels.keys()]) {
    broadcast(baseId, { type: 'change', baseId });
  }
}

// Graceful shutdown (SIGTERM/SIGINT in server.ts / realtime-server.ts):
// close every client with 1001 "going away" so browsers and reconnecting
// clients fail over immediately instead of hanging on a dying process.
// Channel/client bookkeeping is cleaned up by each socket's 'close' handler
// (onClose); nothing here needs to touch the maps directly.
export function closeAll(): void {
  for (const ws of clients.keys()) {
    ws.close(1001, 'server shutting down');
  }
}

// Presence carries userId + display name only — never email (PII).
function broadcastPresence(baseId: string): void {
  const chan = channels.get(baseId);
  if (!chan) return;
  const seen = new Map<string, UserMeta>();
  for (const ws of chan) {
    const m = clients.get(ws);
    if (m && !seen.has(m.userId)) {
      seen.set(m.userId, { userId: m.userId, userName: m.userName });
    }
  }
  broadcast(baseId, { type: 'presence', baseId, users: [...seen.values()] });
}
