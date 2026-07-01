import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';

// Load .env from the app directory (Node 20.6+). No-op if absent.
try {
  process.loadEnvFile();
} catch {
  // .env optional (e.g. production injects real env)
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Dynamically import so auth/db inside the gateway resolve env after loadEnvFile
  // (ESM top-level imports would hoist before the .env load above).
  const { handleUpgrade } = await import('./server/realtime/gateway');

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    handle(req, res, parsedUrl).catch((err) => {
      console.error('Error handling request', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    });
  });

  // Route only /realtime upgrades to the ws gateway; leave others (e.g. Next dev
  // HMR) to their own handlers.
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '', true);
    if (pathname === '/realtime') {
      void handleUpgrade(req, socket, head);
    }
  });

  server.listen(port, () => {
    console.log(`> markpocket ready on http://localhost:${port} (dev=${dev})`);
  });
});
