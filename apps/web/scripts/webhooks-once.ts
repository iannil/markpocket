// Explicit developer action only. Supply DATABASE_URL and WEBHOOK_ENCRYPTION_KEY
// via the shell or tsx --env-file=.env; importing worker never starts a loop.
import { runWebhookBatch } from '../src/server/webhooks/worker';

async function main() {
  try {
    const result = await runWebhookBatch();
    console.log(
      `Webhooks: ${result.claimed} claimed, ${result.succeeded} succeeded, ${result.failed} failed.`,
    );
  } catch {
    console.error('Webhook batch failed. Check database access and retry.');
    process.exitCode = 1;
  } finally {
    const { sql } = await import('../src/server/db');
    await sql.end();
  }
}
void main();
