import type { Config } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // .env optional
}

export default {
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
