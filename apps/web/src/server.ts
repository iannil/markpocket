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

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    handle(req, res, parsedUrl).catch((err) => {
      console.error('Error handling request', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    });
  });

  // Phase 3: the WebSocket gateway attaches to this same HTTP server.
  //   import { WebSocketServer } from 'ws';
  //   new WebSocketServer({ server });

  server.listen(port, () => {
    console.log(`> markpocket ready on http://localhost:${port} (dev=${dev})`);
  });
});
