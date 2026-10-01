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
  g.__markpocketPgClient ?? postgres(url, { max: 10, idle_timeout: 30, max_lifetime: 60 * 30 });
if (!g.__markpocketPgClient) g.__markpocketPgClient = client;

export const db = drizzle(client, { schema });

// Raw postgres client, exposed for LISTEN/NOTIFY (cross-process realtime delivery).
export const sql = client;
