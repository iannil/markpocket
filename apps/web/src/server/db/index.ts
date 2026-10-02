import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set');
}

// globalThis guard: Next dev HMR reloads this module per change — without it,
// every reload leaks a new connection pool.
const g = globalThis as unknown as { __markpocketPgClient?: ReturnType<typeof postgres> };
const client =
  g.__markpocketPgClient ??
  postgres(url, {
    max: 10,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    // Per-connection lock_timeout (sent as a startup parameter — postgres.js'
    // officially supported `connection` config, applied to every pooled
    // session): a wait on any advisory or row lock longer than 5s errors out
    // instead of pinning one of only 10 pool slots. Without it, one stuck lock
    // holder (e.g. a long delete transaction) cascades into pool exhaustion
    // and takes the whole instance down. Milliseconds, per Postgres' unit for
    // a bare lock_timeout value.
    connection: { lock_timeout: 5_000 },
  });
if (!g.__markpocketPgClient) g.__markpocketPgClient = client;

export const db = drizzle(client, { schema });

// Raw postgres client, exposed for LISTEN/NOTIFY (cross-process realtime delivery).
export const sql = client;
