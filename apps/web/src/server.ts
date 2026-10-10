import { createServer, type Server } from 'node:http';
import { fileURLToPath, parse } from 'node:url';
import next from 'next';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Load .env from the app directory (Node 20.6+). No-op if absent.
try {
  process.loadEnvFile();
} catch {
  // .env optional (e.g. production injects real env)
}

// This module is the production entry point (dev runs `next dev` separately,
// see dev.sh) — default to production so `pnpm start` works without a shell
// env prefix on every platform (the old `NODE_ENV=production tsx …` script
// prefix broke on Windows). next({ dev }) reads this flag lazily, so setting
// it before the `next()` call below is equivalent to the env variable.
// Object.assign sidesteps Next's read-only typing of process.env.NODE_ENV.
if (process.env.NODE_ENV == null) {
  Object.assign(process.env, { NODE_ENV: 'production' });
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

// Fail closed: a weak/missing session secret means forgeable session cookies.
// The Docker build deliberately ships no secret — operators MUST provide one.
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  if (
    !secret ||
    secret.length < 32 ||
    /^placeholder/i.test(secret) ||
    /^build-time/i.test(secret)
  ) {
    console.error(
      'FATAL: BETTER_AUTH_SECRET must be set to a random string of at least 32 characters ' +
        '(e.g. `openssl rand -base64 32`). Refusing to start.',
    );
    process.exit(1);
  }
}

// Runs on boot in production. Guarded by a session-level pg advisory lock so
// concurrent replicas (or a rolling restart's overlap) serialize instead of
// racing the migration journal. Idempotent: drizzle skips applied migrations.
// The key sits far above the int4 range on purpose: hashtext() (cell.ts's
// per-cell and field.ts's per-table locks) returns int4, so any hashtext-
// derived key could otherwise collide with this one and silently serialize
// migrations against row writes (or vice versa).
const MIGRATION_LOCK_KEY = '623726502000000001'; // arbitrary fixed key, markpocket-only

async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const migrationsFolder = fileURLToPath(new URL('./server/db/migrations', import.meta.url));
  // One-shot connection, deliberately NOT the app pool. pg advisory locks
  // are session-scoped, so lock and unlock must land on the same session —
  // and every pooled session carries lock_timeout=5s (db/index.ts), under
  // which this design's two legitimate long waits abort with 55P03 and
  // exit(1) instead of waiting: a second replica parking on the advisory
  // lock while the first migrates, and DDL waiting out a LOCK TABLE on a
  // busy database. Both contradict the serialization the lock exists to
  // provide, so the whole migration runs on a dedicated connection without
  // lock_timeout, .end()ed below — the pool is never touched.
  const conn = postgres(url, { max: 1 });
  try {
    // The key is passed as a string and cast in SQL — postgres.js template
    // parameters reject bigint.
    await conn`select pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    await migrate(drizzle(conn), { migrationsFolder });
  } finally {
    try {
      await conn`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    } catch (err) {
      // The session died mid-migration — the server releases session-scoped
      // advisory locks on disconnect, so the unlock is best-effort.
      console.warn('migration advisory unlock failed (session likely closed)', err);
    } finally {
      await conn.end({ timeout: 5 });
    }
  }
}

// Docker sends SIGKILL ~10s after SIGTERM — the graceful sequence below must
// land inside that budget, with the force-exit fallback firing at 8s.
const SHUTDOWN_FORCE_EXIT_MS = 8_000;

// Graceful shutdown: stop accepting new connections (server.close() also
// closes idle keep-alive sockets on Node >=19), tell every ws client to fail
// over (gateway.closeAll), then drain the Postgres pool. A second signal
// during shutdown skips the wait — the operator clearly wants out now.
function registerShutdown(
  server: Server,
  closeAllClients: () => void,
  stopWebhooks: () => Promise<void>,
): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`> ${signal} received — shutting down`);
    const forceExit = setTimeout(() => {
      console.error('graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExit.unref();
    void (async () => {
      let exitCode = 0;
      try {
        // Abort transports and stop claims immediately, before waiting on HTTP drain.
        await Promise.all([
          stopWebhooks(),
          new Promise<void>((resolve) => server.close(() => resolve())),
        ]);
        closeAllClients();
        // Ends the pool AND postgres.js' dedicated LISTEN connection
        // (sql.end() cascades into listen.sql), so nothing is left mid-query.
        const { sql } = await import('./server/db');
        await sql.end({ timeout: 5000 });
      } catch (err) {
        exitCode = 1;
        console.error('error during graceful shutdown', err);
      } finally {
        clearTimeout(forceExit);
        process.exit(exitCode);
      }
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    if (!dev) {
      try {
        await runMigrations();
      } catch (err) {
        console.error('FATAL: database migrations failed:', err);
        process.exit(1);
      }
    }
    // Dynamically import so auth/db inside the gateway resolve env after loadEnvFile
    // (ESM top-level imports would hoist before the .env load above).
    const { handleUpgrade, closeAll } = await import('./server/realtime/gateway');
    const { startRealtimeSubscription } = await import('./server/realtime/subscribe');
    // This single process both mutates and hosts the gateway; deliver via pg so the
    // path is identical to dev (where the gateway runs in a separate process).
    await startRealtimeSubscription();
    const { startWebhookWorker } = await import('./server/webhooks/worker');
    const webhooks = !dev ? startWebhookWorker() : null;

    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url ?? '/', true);
      handle(req, res, parsedUrl).catch((err) => {
        console.error('Error handling request', err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      });
    });

    // Route only /realtime upgrades to the ws gateway. Anything else is
    // destroyed on the spot: this process never serves other upgrades (dev HMR
    // upgrades belong to the separate `next dev` process), and a socket left
    // dangling — neither destroyed nor handed to a handler — is free memory a
    // hostile client can pile up.
    server.on('upgrade', (req, socket, head) => {
      const { pathname } = parse(req.url ?? '', true);
      if (pathname === '/realtime') {
        void handleUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });

    server.listen(port, () => {
      console.log(`> markpocket ready on http://localhost:${port} (dev=${dev})`);
    });

    registerShutdown(server, closeAll, () => webhooks?.stop() ?? Promise.resolve());
  })
  .catch((err: unknown) => {
    // Startup failures (prepare, dynamic imports, subscription wiring) must
    // exit non-zero with a locatable trace — not surface as an unhandled
    // rejection after the process has half-started.
    console.error(
      'FATAL: markpocket server failed to start:',
      err instanceof Error ? err.stack : err,
    );
    process.exit(1);
  });
