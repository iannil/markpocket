import { createServer, type Server } from 'node:http';
import { parse } from 'node:url';

// Standalone realtime gateway for dev. Pages are served by `next dev` on their
// own port; this tiny process only hosts the /realtime WebSocket and fans out
// changes received over the Postgres LISTEN channel. Prod keeps everything in
// server.ts (no bundler, no memory blowup), so this entrypoint is dev-only.
try {
  process.loadEnvFile();
} catch {
  // .env optional
}

const port = Number(process.env.REALTIME_PORT ?? 7419);

// Graceful shutdown (same sequence as server.ts, minus the HTTP app): stop
// accepting upgrades, close every ws client, then end the Postgres
// connections (sql.end() also tears down postgres.js' dedicated LISTEN
// connection). No 8s force-exit needed for tsx watch restarts, but the guard
// costs nothing and keeps an exit from hanging on a stuck socket.
const SHUTDOWN_FORCE_EXIT_MS = 8_000;

function registerShutdown(server: Server, closeAllClients: () => void): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`> realtime gateway: ${signal} received — shutting down`);
    const forceExit = setTimeout(() => {
      console.error('realtime gateway graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExit.unref();
    void (async () => {
      let exitCode = 0;
      try {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        closeAllClients();
        const { sql } = await import('./server/db');
        await sql.end({ timeout: 5000 });
      } catch (err) {
        exitCode = 1;
        console.error('error during realtime gateway shutdown', err);
      } finally {
        clearTimeout(forceExit);
        process.exit(exitCode);
      }
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function main() {
  const { handleUpgrade, closeAll } = await import('./server/realtime/gateway');
  const { startRealtimeSubscription } = await import('./server/realtime/subscribe');
  await startRealtimeSubscription();

  const server = createServer((_req, res) => {
    res.statusCode = 426; // Upgrade Required — this port only speaks WebSocket.
    res.end('realtime gateway');
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '', true);
    if (pathname === '/realtime') {
      void handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> realtime gateway on http://localhost:${port} (dev)`);
  });

  registerShutdown(server, closeAll);
}

main().catch((err: unknown) => {
  // Startup failures (imports, LISTEN wiring) must exit non-zero with a
  // locatable trace instead of surfacing as an unhandled rejection.
  console.error('FATAL: realtime gateway failed to start:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
