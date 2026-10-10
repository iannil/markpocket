# ADR-0015: Webhook subscriptions and PostgreSQL outbox

Status: Accepted (credentials, transport and subscription model implemented; outbox, worker and management UI follow in I4–I6).

## Decision

Keep webhooks inside the application and PostgreSQL; add no queue service or runtime dependency. A Base owner may create up to five subscriptions per table, including active, paused, overflow and disabled subscriptions. Creation serializes on the transaction advisory lock `webhook-subscriptions:<tableId>` and holds the current owner membership row FOR SHARE through commit. Explicit removal frees capacity. A URL is immutable: an owner explicitly disables/removes the old subscription and creates a new subscription, so queued deliveries cannot silently change targets.

Only `record.changed` and `record.deleted` are supported. Subscription secrets contain 32 random bytes, encoded as hex for HMAC use, and are returned only by creation or future rotation. AES-256-GCM encrypts them under the independent canonical base64 32-byte `WEBHOOK_ENCRYPTION_KEY`; the format is `v1.<iv base64>.<tag base64>.<ciphertext base64>`, with a random 12-byte nonce and 16-byte authentication tag. Missing/invalid keys disable creation and sending, without discarding pending deliveries; there is no fallback to the session secret. UI projections must never expose stored ciphertext. Logs and errors must never contain secrets or complete URL queries.

Each POST validates HTTPS on port 443, no userinfo or fragment, and a maximum URL length of 2048. Query parameters are allowed. Every send resolves all DNS answers, rejects the whole set if any address is nonpublic, and pins the approved address into Node HTTPS lookup. TLS and Host retain the original hostname. Connection pooling is disabled to avoid reusing an unvalidated connection. The existing Airtable public-address predicate is reused without modifying its attachment-host allowlist. A five-second total deadline includes DNS and response reading; responses above 64 KiB are destroyed. Redirects return their status and are never followed. Server-only resolver/request injection permits tests without external sends.

## Outbox and delivery contract for I4–I6

PostgreSQL triggers cover record/cell mutations, including plugins, CSV and Airtable imports. Events are visible only after commit, disappear on rollback, and deduplicate by `(subscriptionId, txid, recordId)`; deletion wins within a transaction. Payloads include only eventId, type, baseId, tableId, recordId and occurredAt. Consumers retrieve values with a separately scoped token; deleted records are handled by ID. Initial imports can generate many notifications.

The in-process worker claims at most 20 deliveries per second using SKIP LOCKED, concurrency two and 30-second leases. Automatic delivery allows five attempts with retry delays of 1s/10s/60s/300s: 2xx succeeds, 408/429/5xx and network failures retry, and other 4xx/3xx terminate. Delivery is at least once; receivers deduplicate by eventId. Sign exact UTF-8 body bytes with HMAC-SHA256 over `timestamp + '.' + rawBody`, using X-MarkPocket-Event, X-MarkPocket-Timestamp and X-MarkPocket-Signature headers.

At 10,000 pending/leased deliveries, mark the subscription overflow, record overflowAt and stop collecting new events without failing business writes. The resulting gap is explicit and not lossless. Owner-confirmed recovery requires reconciliation. Keep terminal delivery logs seven days with bounded cleanup. Owners may pause/resume and manually retry an individual dead delivery. Recheck creator ownership before sending; loss of owner permission pauses delivery. Base/table deletion cascades subscriptions and their queued deliveries.

Rotation must clear in-flight leases and pending sends must use the new secret; an already dispatched request can still complete under the old secret. Rotation and other lifecycle APIs are deferred until the outbox exists, so lease clearing can be implemented atomically. Production worker shutdown follows server.ts: stop claims, drain or abort requests, then close PostgreSQL. Development uses an explicit one-shot worker command, not another service.

## Implementation interfaces

`crypto.ts`: encryptSecret, decryptSecret, signWebhook, getWebhookEncryptionKey (Buffer or null).

`transport.ts`: postWebhook(url, body, headers, signal) returns only `{ status }`; parseWebhookUrl validates syntax and literal-address safety; createWebhookTransport provides server-side test injection.

`subscriptions.ts`: createSubscription(userId, input) returns `{ id, secret }` once; lockWebhookSubscriptions and assertWebhookOwner are shared transaction primitives. Later mutations must acquire the same table lock before re-reading subscription state and checking owner membership. No list or rotation endpoint exists yet.
