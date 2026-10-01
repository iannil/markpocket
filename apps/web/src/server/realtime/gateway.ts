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
}

// Cap per-connection channel subscriptions — a hostile client must not be able
// to grow unbounded state server-side.
const MAX_CHANNELS_PER_CLIENT = 32;
const HEARTBEAT_MS = 30_000;

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, ClientMeta>();
const channels = new Map<string, Set<WebSocket>>(); // baseId -> connections

export function getGateway(): WebSocketServer {
  if (!wss) {
    wss = new WebSocketServer({ noServer: true });
    startHeartbeat();
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
  const meta: ClientMeta = { ...user, baseIds: new Set(), isAlive: true };
  clients.set(ws, meta);
  ws.on('pong', () => {
    meta.isAlive = true;
  });
  ws.on('message', (data) => void onMessage(ws, meta, data));
  ws.on('close', () => onClose(ws, meta));
  ws.on('error', () => onClose(ws, meta));
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

export function broadcast<T extends object>(baseId: string, event: T, exceptUserId?: string): void {
  const chan = channels.get(baseId);
  if (!chan) return;
  const json = JSON.stringify(event);
  for (const ws of chan) {
    const m = clients.get(ws);
    if (!m || m.userId === exceptUserId) continue;
    if (ws.readyState === ws.OPEN) ws.send(json);
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
