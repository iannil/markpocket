import type { Server } from 'node:http';

// Resolve only when HTTP requests and webhook sends no longer need the DB.
export async function drainServer(
  server: Server,
  closeAllClients: () => void,
  stopWebhooks: () => Promise<void>,
): Promise<void> {
  await Promise.all([
    stopWebhooks(),
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Upgraded sockets keep server.close() pending until they disconnect.
      // Start the WS handshake now, before waiting for HTTP or webhook drain.
      closeAllClients();
    }),
  ]);
}
