# Webhooks

Implemented on the P0–P2 branch, unreleased. Base owners configure receivers in **Settings → Agents → Webhooks**. Select a table, enter a public HTTPS URL and select `record.changed` and/or `record.deleted`. Every state counts toward the five-endpoint table limit. URLs are immutable: remove the old endpoint and create another to change its target. Removal also deletes queued deliveries and logs.

Configure an independent `WEBHOOK_ENCRYPTION_KEY`: canonical base64 encoding of 32 random bytes. Keep it with protected instance backup configuration. Signing secrets are encrypted with AES-256-GCM; the session secret is never reused. Creation and rotation show the signing secret once. Lists, delivery logs and errors expose neither secrets nor ciphertext. Keep endpoint query credentials out of operator logs.

Only HTTPS/443 is accepted, with no userinfo or fragment and at most 2048 characters. Each delivery resolves DNS again, rejects any nonpublic answer, pins the approved address and preserves TLS hostname verification. Redirects are not followed. Requests have a five-second deadline and a 64 KiB response limit.

## Payload and verification

The JSON body contains exactly `eventId`, `type`, `baseId`, `tableId`, `recordId`, and `occurredAt`; no cell values. `X-MarkPocket-Event` is the event ID. `X-MarkPocket-Timestamp` is integer Unix seconds; `X-MarkPocket-Signature` is `sha256=` followed by 64 hexadecimal digits. Verify the original bytes before JSON parsing:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(rawBody: Buffer, timestamp: string, signature: string, secret: string) {
  if (!/^\d+$/.test(timestamp) || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) {
    throw new Error('Invalid signature');
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) {
    throw new Error('Invalid signature');
  }
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.', 'utf8').update(rawBody).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('Invalid signature');
  }
  return JSON.parse(rawBody.toString('utf8'));
}
```

Reject missing or duplicate signature/timestamp headers in the HTTP adapter, read a bounded raw body and keep clocks synchronized. After verification, validate the event shape and persist `eventId` under a unique constraint before executing side effects. Commit deduplication and local effects in one transaction, or atomically enqueue durable work keyed by `eventId`; an in-memory Set is insufficient. Return a quick 2xx after durable acceptance; duplicates also return 2xx. Coordinate external effects with durable idempotency keys so a crash cannot repeat them.

Fetch current values using a separate Base-bound, read-only token ([REST example](api/agent-access.md#webhook-consumer-with-a-scoped-token)). Handle deletion by ID. Events may arrive out of order; a changed record now returning 404 should be treated as deleted. Automatic retries and crash recovery retain the event ID and metadata body, with a fresh timestamp/signature per send.

## Delivery and recovery

All committed record/cell writes, including CSV and plugin/import writes, collect events through PostgreSQL triggers. Rollback produces no event. Multiple cell changes in one transaction coalesce per record/subscription; deletion wins. Initial imports may generate many notifications. The current Airtable importer creates fresh tables with no preexisting subscriptions.

The in-process worker claims at most 20 events per batch, concurrency two, with 30-second leases. Production waits one second after each settled batch. It permits five automatic attempts, delaying retries by 1s, 10s, 60s and 300s. 2xx succeeds; 408/429/5xx/network/timeout retries; other 4xx/3xx and unsafe destinations end as dead. Owners can retry one dead event with its original ID and attempts reset to zero. Retry does not resume a paused endpoint and is refused at queue capacity. Succeeded, pending and leased events cannot be manually retried. Terminal logs are retained seven days from event occurrence, with bounded cleanup. An event that finishes after that window can be removed at the next cleanup; retention does not restart when delivery completes.

**Pause** retains queued work but stops collecting new events. At 10,000 pending/leased events an endpoint becomes **Overflow**, records `overflowAt`, and stops collecting without rejecting business writes. Changes during paused, overflow or disabled periods are not queued. Reconcile records from the source before resuming. Overflow recovery requires explicit acknowledgement. Pause/rotation cannot clear that marker; only acknowledged recovery does. This is at-least-once delivery of queued events, not a lossless change log.

**Disabled** means the worker cannot use the encryption key. Key preflight preserves queued IDs, attempts and leases. Restoring the key alone does not resume delivery. Restore the original key, or configure a valid replacement and rotate the signing secret; update the receiver, then explicitly resume. Rotation invalidates outstanding lease tokens and queued sends use the new secret. Already dispatched requests cannot be recalled and may finish with the old secret: briefly accept both keys at the receiver. Pause/removal also cannot recall dispatched bytes; stale acknowledgements cannot overwrite replacement work.

Pause, rotation and explicit resume invalidate in-flight leases without resetting their automatic attempt budget. Earlier attempts return to pending; a fifth attempt becomes dead and requires an owner's explicit retry. The receiver may already have accepted that attempt, so retry retains the same event ID for deduplication.

The worker checks the configuring owner's current membership and pauses after owner loss. Any current Base owner may explicitly resume after validating key/configuration and reconciling gaps. Resume adopts that person as configuring owner (`createdBy` is this responsibility field, not immutable creator history). Rotation alone neither adopts ownership nor activates delivery. Base/Table deletion cascades subscriptions and deliveries.

Production starts the worker after migrations; shutdown stops claims, aborts/drains requests and finishes acknowledgements before closing PostgreSQL. Development has no resident sender. Intentionally run `cd apps/web && pnpm exec tsx --env-file=.env scripts/webhooks-once.ts` to send one bounded batch to configured receivers. Tests use injected transport and an isolated database. No real public receiver was contacted for implementation acceptance; final candidate runtime/recovery and same-origin browser checks remain tracked in [release evidence](release/2026-10-10-p0-p2-evidence.md).
