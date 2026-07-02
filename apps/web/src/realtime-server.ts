import { createServer } from 'node:http';
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

async function main() {
  const { handleUpgrade } = await import('./server/realtime/gateway');
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
}

void main();
