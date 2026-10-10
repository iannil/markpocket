import { once } from 'node:events';
import { createServer, get, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { drainServer } from './drain-server';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const request = deferred<ServerResponse>();
  const server = createServer((_req, res) => request.resolve(res));
  const gateway = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/realtime`);
  await once(client, 'open');
  cleanups.push(async () => {
    client.terminate();
    for (const ws of gateway.clients) ws.terminate();
    server.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => gateway.close(() => resolve())),
    ]);
  });
  return {
    server,
    client,
    url: `http://127.0.0.1:${address.port}`,
    request: request.promise,
    closeAllClients: () => {
      for (const ws of gateway.clients) ws.close(1001, 'server shutting down');
    },
  };
}

it('closes a connected WebSocket so the HTTP server can finish shutdown', async () => {
  const { server, client, closeAllClients } = await fixture();
  const closed = once(client, 'close', { signal: AbortSignal.timeout(1000) });
  const drained = drainServer(server, closeAllClients, () => Promise.resolve());
  expect(server.listening).toBe(false);
  const [code, reason] = await closed;
  expect(code).toBe(1001);
  expect(reason.toString()).toBe('server shutting down');
  await drained;
});

it.each(['http', 'webhooks'])(
  'disconnects WebSockets promptly and waits for both drains when %s settles first',
  async (first) => {
    const { server, client, url, request, closeAllClients } = await fixture();
    const response = new Promise<void>((resolve, reject) => {
      get(url, { agent: false }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    const activeResponse = await request;
    const webhooks = deferred<void>();
    let webhookAborted = false;
    let databaseClosed = false;
    const closed = once(client, 'close', { signal: AbortSignal.timeout(1000) });
    const httpClosed = once(server, 'close');
    const drained = drainServer(server, closeAllClients, () => {
      webhookAborted = true;
      return webhooks.promise;
    }).then(() => {
      databaseClosed = true;
    });
    try {
      // The production caller ends Postgres only after this drain resolves.
      expect(webhookAborted).toBe(true);
      expect(server.listening).toBe(false);
      await closed;
      expect(databaseClosed).toBe(false);
      if (first === 'http') {
        activeResponse.end('in-flight request completed');
        await response;
        await httpClosed;
        expect(databaseClosed).toBe(false);
        webhooks.resolve();
      } else {
        webhooks.resolve();
        await setImmediate();
        expect(databaseClosed).toBe(false);
        activeResponse.end('in-flight request completed');
        await response;
        await httpClosed;
      }
      await drained;
      expect(databaseClosed).toBe(true);
    } finally {
      activeResponse.end();
      webhooks.resolve();
      await response;
    }
  },
);
