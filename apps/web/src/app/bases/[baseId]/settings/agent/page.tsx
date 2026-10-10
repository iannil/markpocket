'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';

function CodeLine({ text }: { text: string }) {
  return <code className="block truncate font-mono text-xs text-muted-foreground">{text}</code>;
}

export default function AgentTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  useBreadcrumbSetter([{ label: 'Agents' }]);

  const tokens = trpc.token.list.useQuery();
  const shares = trpc.share.list.useQuery({ baseId });

  const [newName, setNewName] = useState('');
  const [tokenScope, setTokenScope] = useState('current');
  const [access, setAccess] = useState<'read' | 'write'>('read');
  const [expiry, setExpiry] = useState('days');
  const [expiryDays, setExpiryDays] = useState('30');
  const [creating, setCreating] = useState(false);
  // The plaintext token exists only in this piece of state until the dialog
  // closes — it is never persisted, listed, or logged.
  const [minted, setMinted] = useState<{ token: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const createToken = trpc.token.create.useMutation({
    onSuccess: (row) => {
      void utils.token.list.invalidate();
      setMinted({ token: row.token, name: row.row.name });
      setNewName('');
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setCreating(false),
  });
  const revokeToken = trpc.token.revoke.useMutation({
    onSuccess: () => {
      void utils.token.list.invalidate();
      toast.success('Token revoked');
      setRevokeTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // window.location.origin is browser-only: deriving it during render made
  // the SSR pass emit empty URLs and hydration swap them in — a mismatch
  // warning and one frame of wrong, copyable URLs. Set it in an effect so
  // server and first client render agree.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const mcpConfig = useMemo(
    () => JSON.stringify({ mcpServers: { markpocket: { url: `${origin}/api/mcp` } } }, null, 2),
    [origin],
  );
  const viewShares = (shares.data ?? []).filter((s) => s.viewId);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-sm font-semibold">API tokens</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Bearer tokens for the REST API (<code>/api/v1</code>) and MCP server. A token acts as you
          within the scope and access you choose, limited by your current membership role. New
          tokens default to this base, read access and 30 days. The full value is shown once at
          creation and cannot be recovered.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCreating(true);
            createToken.mutate({
              name: newName,
              baseId: tokenScope === 'current' ? baseId : null,
              access,
              expiresInDays: expiry === 'never' ? null : Number(expiryDays),
            });
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <input
            aria-label="Token name"
            required
            minLength={1}
            maxLength={64}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="token name (e.g. my-laptop)"
            className="h-8 min-w-0 w-full sm:w-56 sm:flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Scope
            <select
              value={tokenScope}
              onChange={(e) => setTokenScope(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="current">Current base</option>
              <option value="all">All accessible bases</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Access
            <select
              value={access}
              onChange={(e) => setAccess(e.target.value as 'read' | 'write')}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="read">Read</option>
              <option value="write">Read &amp; write</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Expiry
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="days">Expires after</option>
              <option value="never">Never expires</option>
            </select>
          </label>
          {expiry === 'days' && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Days until expiry
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                required
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={creating}
            className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            create token
          </button>
        </form>

        {minted && (
          // Inline panel (same pattern as the invite link) instead of a
          // modal: an in-context reveal interrupts less than a dialog, and
          // the copy action stays available for as long as the panel is open.
          <div
            role="dialog"
            aria-label="Token created"
            className="mt-3 space-y-2 rounded-md border border-border p-3"
          >
            <p className="text-sm font-semibold">Token “{minted.name}” created — copy it now</p>
            <p className="text-xs text-muted-foreground">
              This is the only time the full value is shown. Store it somewhere safe; revoking is
              the only remedy for a lost token.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted/50 px-2 py-1 font-mono text-xs">
                {minted.token}
              </code>
              <button
                onClick={() => copyToClipboard(minted.token, 'Token copied')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                copy
              </button>
              <button
                onClick={() => setMinted(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                done
              </button>
            </div>
          </div>
        )}

        {tokens.isLoading && tokens.data === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : tokens.data && tokens.data.length > 0 ? (
          <ul className="mt-3 border-t border-border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{t.name}</div>
                  <p className="text-xs text-muted-foreground">
                    {t.baseId === null
                      ? 'All bases'
                      : t.baseId === baseId
                        ? 'Current base'
                        : `Base ${t.baseId}`}
                    {' · '}
                    {t.access === 'write' ? 'Read & write' : 'Read'}
                    {' · '}
                    {t.expiresAt
                      ? `${new Date(t.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Expires'} ${new Date(t.expiresAt).toLocaleDateString()}`
                      : 'Never expires'}
                  </p>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <CodeLine text={`${t.tokenPrefix}…`} />
                    <span className="text-[10px] text-muted-foreground">
                      created {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt
                        ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
                        : ' · never used'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setRevokeTarget({ id: t.id, name: t.name })}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No tokens yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">MCP server</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Point MCP clients (Claude Code, Cursor, …) at this endpoint and add the token as a Bearer
          header.
        </p>
        <div className="flex items-center gap-2">
          <CodeLine text={`${origin}/api/mcp`} />
          <button
            onClick={() => copyToClipboard(`${origin}/api/mcp`, 'Endpoint copied')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            copy
          </button>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed">
            {mcpConfig}
          </pre>
          <button
            onClick={() => copyToClipboard(mcpConfig, 'MCP config copied')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            copy
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">REST API</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Full CRUD over bases, tables, fields, views and records —{' '}
          <code>Authorization: Bearer &lt;token&gt;</code>.
        </p>
        <div className="flex items-center gap-2">
          <CodeLine text={`${origin}/api/v1`} />
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            openapi.json
          </a>
          <button
            onClick={() => copyToClipboard(`${origin}/api/v1`, 'API base URL copied')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            copy
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">RSS feeds</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Public share links pinned to a view also expose an RSS feed of that view (newest records
          first). Create or manage share links in the Members tab.
        </p>
        {viewShares.length > 0 ? (
          <ul className="border-t border-border">
            {viewShares.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <CodeLine text={`/feed/${s.token}`} />
                  <span className="text-[10px] text-muted-foreground">
                    {s.expiresAt
                      ? new Date(s.expiresAt) < new Date()
                        ? 'expired'
                        : `expires ${new Date(s.expiresAt).toLocaleDateString()}`
                      : 'no expiry'}
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(`${origin}/feed/${s.token}`, 'Feed URL copied')}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  copy
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No view-pinned share links in this base yet.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Agent Skill</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          A ready-to-install skill document that teaches agents this instance’s API, MCP and RSS
          surfaces.
        </p>
        <a
          href="/api/skill?download=1"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          download markpocket-SKILL.md
        </a>
      </section>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Requests using this token will start failing immediately with 401. This cannot be
            undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeToken.isPending}
              onClick={() => revokeTarget && revokeToken.mutate({ id: revokeTarget.id })}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
