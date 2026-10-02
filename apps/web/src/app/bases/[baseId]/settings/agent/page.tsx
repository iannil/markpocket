'use client';

import { useMemo, useState } from 'react';
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

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
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
          — it can reach every base you are a member of, with your role. The full value is shown
          once at creation and cannot be recovered.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCreating(true);
            createToken.mutate({ name: newName });
          }}
          className="flex items-center gap-2"
        >
          <input
            required
            minLength={1}
            maxLength={64}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="token name (e.g. my-laptop)"
            className="h-8 w-56 flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={creating}
            className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            create token
          </button>
        </form>

        {tokens.isLoading && tokens.data === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : tokens.data && tokens.data.length > 0 ? (
          <ul className="mt-3 border-t border-border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{t.name}</div>
                  <div className="flex items-baseline gap-2">
                    <CodeLine text={`${t.tokenPrefix}…`} />
                    <span className="shrink-0 text-[10px] text-muted-foreground">
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

      <Dialog open={minted !== null} onOpenChange={(open) => !open && setMinted(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token created — copy it now</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is the only time the full value of <strong>{minted?.name}</strong> is shown. Store
            it somewhere safe; revoking is the only remedy for a lost token.
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed">
            {minted?.token}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMinted(null)}>
              Close
            </Button>
            <Button onClick={() => minted && copyToClipboard(minted.token, 'Token copied')}>
              Copy token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Button onClick={() => revokeTarget && revokeToken.mutate({ id: revokeTarget.id })}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
