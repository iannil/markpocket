'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { trpc } from '@/lib/trpc/client';

type State = 'active' | 'paused' | 'overflow' | 'disabled';
type Endpoint = {
  id: string;
  url: string;
  events: string[];
  state: State;
  overflowAt: string | null;
};
type Event = 'record.changed' | 'record.deleted';

export function WebhookStateNotice({
  state,
  overflowAt,
}: {
  state: State;
  overflowAt: string | null;
}) {
  return (
    <>
      {(state === 'overflow' || overflowAt) && (
        <div className="text-sm text-destructive" role="status">
          <p>Some changes were not queued. Reconcile your records before resuming.</p>
          {overflowAt && <p>Gap since {new Date(overflowAt).toLocaleString()}</p>}
        </div>
      )}
      {state === 'disabled' && (
        <p className="text-sm text-muted-foreground" role="status">
          Ask an administrator to restore WEBHOOK_ENCRYPTION_KEY (32-byte base64). If the original
          key is lost, rotate the signing secret and update your receiver before resuming.
        </p>
      )}
      {state === 'paused' && (
        <p className="text-xs text-muted-foreground">
          Queued deliveries are retained. Changes made while paused are not queued; reconcile your
          records before resuming.
        </p>
      )}
    </>
  );
}

// Nonowners never mount a table, subscription, or delivery management query.
export function WebhookSettings({ baseId }: { baseId: string }) {
  const member = trpc.member.me.useQuery({ baseId });
  if (member.data?.role !== 'owner') return null;
  return <OwnerWebhooks key={baseId} baseId={baseId} />;
}

function OwnerWebhooks({ baseId }: { baseId: string }) {
  const tables = trpc.table.list.useQuery({ baseId });
  const [selected, setSelected] = useState('');
  const tableId = tables.data?.some((t) => t.id === selected) ? selected : tables.data?.[0]?.id;
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-semibold">Webhooks</h2>
      <p className="text-xs text-muted-foreground">
        Send signed record change notifications to HTTPS receivers. Up to 5 endpoints per table,
        including paused and disabled endpoints. Only base owners can manage delivery.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        Webhook table
        <select
          className="w-full min-w-0 rounded-md border bg-background p-2"
          value={tableId ?? ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          {tables.data?.map((t) => (
            <option value={t.id} key={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {tables.error && <p role="alert">{tables.error.message}</p>}
      {!tables.isLoading && !tableId && (
        <p className="text-sm">Create a table to configure webhooks.</p>
      )}
      {tableId && <TableWebhooks key={tableId} tableId={tableId} />}
    </section>
  );
}

function TableWebhooks({ tableId }: { tableId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.webhook.list.useQuery({ tableId }, { refetchInterval: 5000 });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Event[]>(['record.changed']);
  const [secret, setSecret] = useState<string | null>(null);
  const create = trpc.webhook.create.useMutation({
    onSuccess: (row) => {
      setSecret(row.secret);
      setUrl('');
      void utils.webhook.list.invalidate({ tableId });
    },
  });
  return (
    <div className="space-y-3">
      {list.error && (
        <p role="alert" className="text-sm text-destructive">
          {list.error.message}
        </p>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ tableId, url, events });
        }}
      >
        <label className="block text-sm">
          HTTPS endpoint
          <input
            className="mt-1 w-full min-w-0 rounded-md border bg-background p-2"
            type="url"
            required
            maxLength={2048}
            placeholder="https://receiver.example/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {(['record.changed', 'record.deleted'] as const).map((event) => (
            <label className="text-xs" key={event}>
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={(e) =>
                  setEvents(
                    e.target.checked ? [...events, event] : events.filter((v) => v !== event),
                  )
                }
              />{' '}
              {event}
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={create.isPending || !events.length || !list.data || list.data.length >= 5}
          type="submit"
        >
          Create endpoint
        </Button>
        {(list.data?.length ?? 0) >= 5 && (
          <p className="text-xs">
            All 5 endpoint slots are used. Remove an endpoint to free a slot.
          </p>
        )}
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </form>
      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}
      {list.data?.map((endpoint) => (
        <EndpointCard key={endpoint.id} endpoint={endpoint} tableId={tableId} />
      ))}
    </div>
  );
}

function SecretReveal({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Webhook signing secret"
      className="space-y-2 rounded-md border p-3"
    >
      <p className="text-sm">Copy this signing secret now. It is shown only once.</p>
      <code className="block break-all text-xs">{secret}</code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => copyToClipboard(secret, 'Secret copied')}
        >
          Copy secret
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function EndpointCard({ endpoint, tableId }: { endpoint: Endpoint; tableId: string }) {
  const utils = trpc.useUtils();
  const [offset, setOffset] = useState(0);
  const [acknowledgeGap, setAcknowledgeGap] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const deliveries = trpc.webhook.deliveries.useQuery(
    { id: endpoint.id, offset, limit: 10 },
    { refetchInterval: 5000 },
  );
  const refresh = () => {
    void utils.webhook.list.invalidate({ tableId });
    void utils.webhook.deliveries.invalidate({ id: endpoint.id });
  };
  const pause = trpc.webhook.pause.useMutation({ onSuccess: refresh });
  const resume = trpc.webhook.resume.useMutation({
    onSuccess: () => {
      setAcknowledgeGap(false);
      refresh();
    },
  });
  const rotate = trpc.webhook.rotate.useMutation({
    onSuccess: (row) => {
      setSecret(row.secret);
      setRotateOpen(false);
      refresh();
    },
  });
  const remove = trpc.webhook.remove.useMutation({ onSuccess: refresh });
  const retry = trpc.webhook.retry.useMutation({ onSuccess: refresh });
  const busy = [pause, resume, rotate, remove, retry].some((m) => m.isPending);
  const error = [pause, resume, rotate, remove, retry].find((m) => m.error)?.error;
  const gap = endpoint.state === 'overflow' || !!endpoint.overflowAt;
  return (
    <article className="min-w-0 space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="break-all text-sm">{endpoint.url}</p>
        <p className="text-xs">
          <strong>{endpoint.state[0].toUpperCase() + endpoint.state.slice(1)}</strong> ·{' '}
          {endpoint.events.join(', ')}
        </p>
      </div>
      <WebhookStateNotice state={endpoint.state} overflowAt={endpoint.overflowAt} />
      {gap && (
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={acknowledgeGap}
            onChange={(e) => setAcknowledgeGap(e.target.checked)}
          />{' '}
          I reconciled my records and acknowledge the gap.
        </label>
      )}
      {endpoint.state !== 'active' && (
        <p className="text-xs text-muted-foreground">
          Resuming makes you the configuring owner. Future delivery requires you to remain an owner.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {endpoint.state === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => pause.mutate({ id: endpoint.id })}
          >
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (gap && !acknowledgeGap)}
            onClick={() => resume.mutate({ id: endpoint.id, acknowledgeGap })}
          >
            Resume
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRotateOpen(true)}>
          Rotate secret
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoveOpen(true)}>
          Remove
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}
      <h3 className="text-xs font-semibold">Recent deliveries</h3>
      {deliveries.error && <p role="alert">{deliveries.error.message}</p>}
      {deliveries.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No deliveries on this page. Terminal logs are retained for 7 days.
        </p>
      )}
      <ul className="space-y-2">
        {deliveries.data?.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs"
          >
            <div className="min-w-0">
              <p>
                {row.type} · {row.state} · {row.attempts} attempts
              </p>
              <p>
                {new Date(row.time).toLocaleString()}
                {row.lastStatus ? ` · HTTP ${row.lastStatus}` : ''}
                {row.lastError ? ` · ${row.lastError}` : ''}
              </p>
              <code className="break-all">{row.id}</code>
            </div>
            {row.state === 'dead' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => retry.mutate({ deliveryId: row.id })}
              >
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0 || deliveries.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 10))}
        >
          Previous deliveries
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={deliveries.data?.length !== 10 || deliveries.isFetching}
          onClick={() => setOffset(offset + 10)}
        >
          Next deliveries
        </Button>
      </div>
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove webhook endpoint?"
        description="This permanently deletes the endpoint, queued deliveries and delivery logs. To change a URL, remove this endpoint and create another."
        confirmLabel="Remove endpoint"
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: endpoint.id })}
      />
      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate signing secret?"
        description="Update your receiver with the new secret. Requests already sent may finish with the old secret; briefly accept both keys. Rotation does not resume a paused or disabled endpoint."
        confirmLabel="Rotate secret"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate({ id: endpoint.id })}
      />
    </article>
  );
}
