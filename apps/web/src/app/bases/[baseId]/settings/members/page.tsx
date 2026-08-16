'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { toast } from '@/lib/toast';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';

type InviteRole = 'editor' | 'viewer';

function InviteSection({ baseId }: { baseId: string }) {
  const utils = trpc.useUtils();
  const invites = trpc.invite.list.useQuery({ baseId });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createInvite = trpc.invite.create.useMutation({
    onSuccess: (row) => {
      void utils.invite.list.invalidate({ baseId });
      toast.success('Invite created');
      navigator.clipboard.writeText(`${window.location.origin}/invite/${row.token}`);
      toast.info('Invite link copied to clipboard');
      setEmail('');
    },
    onError: (err) => {
      toast.error(err.message);
      setError(err.message);
    },
    onSettled: () => setCreating(false),
  });
  const deleteInvite = trpc.invite.delete.useMutation({
    onSuccess: () => void utils.invite.list.invalidate({ baseId }),
    onError: (err) => toast.error(err.message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    createInvite.mutate({ baseId, email, role });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
          className="h-8 w-56 flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Select value={role} onValueChange={(v) => v && setRole(v as InviteRole)}>
          <SelectTrigger className="h-8 w-32 text-xs">{role}</SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">editor</SelectItem>
            <SelectItem value="viewer">viewer</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="submit"
          disabled={creating}
          className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          invite
        </button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {invites.isLoading && invites.data === undefined ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : invites.data && invites.data.length > 0 ? (
        <ul className="border-t border-border">
          {invites.data.map((inv) => (
            <li key={inv.id} className="flex items-center gap-2 border-b border-border py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{inv.email}</div>
                <div className="text-xs text-muted-foreground">
                  {inv.role} · invited by {inv.invitedByName ?? 'unknown'}
                </div>
              </div>
              <button
                onClick={() => {
                  // The token is not returned from list for security;
                  // copy is only available from the create response above.
                  toast.info('Copy the invite link from the creation toast');
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                copy
              </button>
              <button
                onClick={() => deleteInvite.mutate({ id: inv.id })}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No pending invites.</p>
      )}
    </div>
  );
}

function initials(s: string): string {
  return s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export default function MembersTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const members = trpc.member.list.useQuery({ baseId });
  const shares = trpc.share.list.useQuery({ baseId });

  const updateRole = trpc.member.updateRole.useMutation({
    onSuccess: () => utils.member.list.invalidate({ baseId }),
  });
  const removeMember = trpc.member.remove.useMutation({
    onSuccess: () => utils.member.list.invalidate({ baseId }),
  });
  const createShare = trpc.share.create.useMutation({
    onSuccess: (row) => {
      void utils.share.list.invalidate({ baseId });
      toast.success('Share link created');
      navigator.clipboard.writeText(`${window.location.origin}/share/${row.token}`);
      toast.info('Link copied to clipboard');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteShare = trpc.share.delete.useMutation({
    onSuccess: () => utils.share.list.invalidate({ baseId }),
    onError: (err) => toast.error(err.message),
  });

  if (members.isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Members</h2>
        <ul className="border-t border-border">
          {members.data?.map((m) => {
            const label = m.name ?? m.email ?? m.userId;
            return (
              <li key={m.userId} className="flex items-center gap-3 border-b border-border py-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-xs">
                  {initials(label)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{m.name ?? m.email ?? m.userId}</div>
                  {m.name && m.email && (
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  )}
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    v &&
                    updateRole.mutate({
                      baseId,
                      userId: m.userId,
                      role: v as 'owner' | 'editor' | 'viewer',
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-24 text-xs">{m.role}</SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">owner</SelectItem>
                    <SelectItem value="editor">editor</SelectItem>
                    <SelectItem value="viewer">viewer</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  onClick={() => {
                    if (confirm(`Remove ${label}?`))
                      removeMember.mutate({ baseId, userId: m.userId });
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Public share links</h2>
          <button
            onClick={() => createShare.mutate({ baseId })}
            disabled={createShare.isPending}
            className="h-7 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            + create link
          </button>
        </div>
        {shares.isLoading && shares.data === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : shares.data && shares.data.length > 0 ? (
          <ul className="border-t border-border">
            {shares.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <code className="flex-1 truncate text-xs text-muted-foreground">
                  /share/{s.token}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/share/${s.token}`);
                    toast.success('Link copied');
                  }}
                  className="text-xs hover:text-foreground"
                >
                  copy
                </button>
                <button
                  onClick={() => deleteShare.mutate({ id: s.id })}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No public links yet.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Invite</h2>
        </div>
        <InviteSection baseId={baseId} />
      </section>
    </div>
  );
}
