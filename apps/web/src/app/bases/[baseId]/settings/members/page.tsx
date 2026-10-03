'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from '@/lib/toast';
import { initials } from '@/lib/initials';
import { copyToClipboard } from '@/lib/clipboard';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { errorMessage } from '@/lib/trpc-error';
import { useSession } from '@/lib/auth-client';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';

type InviteRole = 'editor' | 'viewer';

function isExpired(expiresAt: string | null | undefined): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() < Date.now();
}

function InviteSection({ canInvite }: { canInvite: boolean }) {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const invites = trpc.invite.list.useQuery({ baseId });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [creating, setCreating] = useState(false);
  // The plaintext link exists only in this state until the dialog closes —
  // the token is deliberately not returned from invite.list.
  const [mintedInvite, setMintedInvite] = useState<{ url: string; email: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);

  const createInvite = trpc.invite.create.useMutation({
    onSuccess: (row) => {
      void utils.invite.list.invalidate({ baseId });
      setEmail('');
      // One-shot dialog (same pattern as API tokens): the creation toast's
      // 3-second window was the only copy opportunity, and clipboard calls
      // outside a user-activation window can silently fail — losing the link
      // meant deleting and re-inviting.
      setMintedInvite({
        url: `${window.location.origin}/invite/${row.token}`,
        email: row.email,
      });
    },
    onSettled: () => setCreating(false),
  });
  const deleteInvite = trpc.invite.delete.useMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      void utils.invite.list.invalidate({ baseId });
    },
    onError: (err) => toast.error(err.message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    createInvite.mutate({ baseId, email: email.trim(), role });
  }

  return (
    <div className="space-y-3">
      {canInvite && (
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            type="email"
            required
            name="invite-email"
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
      )}
      {/* Single error channel: the toast from onError covers transient
          failures; a permanent inline copy of the same message is noise. */}
      {createInvite.isError && (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage(createInvite.error)}
        </p>
      )}

      {invites.isLoading && invites.data === undefined ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : invites.isError ? (
        <p className="text-xs text-destructive" role="alert">
          Failed to load invites.
        </p>
      ) : invites.data && invites.data.length > 0 ? (
        <ul className="border-t border-border">
          {invites.data.map((inv) => {
            const expired = isExpired(inv.expiresAt);
            return (
              <li key={inv.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {inv.email}
                    {expired && (
                      <span className="ml-1.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive">
                        expired
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {inv.role} · invited by {inv.invitedByName ?? 'unknown'}
                    {inv.expiresAt && !expired
                      ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                {canInvite && (
                  <button
                    onClick={() => setDeleteTarget({ id: inv.id, email: inv.email })}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {canInvite ? 'No pending invites. Links expire after 48 hours.' : 'No pending invites.'}
        </p>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete invite for ${deleteTarget?.email ?? ''}?`}
        description="The link stops working immediately. The person can be re-invited at any time."
        confirmLabel="Delete invite"
        pending={deleteInvite.isPending}
        onConfirm={() => deleteTarget && deleteInvite.mutate({ id: deleteTarget.id })}
      />

      {mintedInvite && (
        <div
          role="dialog"
          aria-label="Invite link created"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <p className="text-sm font-semibold">
            Invite link for {mintedInvite.email} — copy it now
          </p>
          <p className="text-xs text-muted-foreground">
            Shown once and expiring after 48 hours. Anyone with the link can join with the invited
            role.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted/50 px-2 py-1 font-mono text-xs">
              {mintedInvite.url}
            </code>
            <button
              onClick={() => copyToClipboard(mintedInvite.url, 'Invite link copied')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              copy
            </button>
            <button
              onClick={() => setMintedInvite(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MembersTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const members = trpc.member.list.useQuery({ baseId });
  const shares = trpc.share.list.useQuery({ baseId });
  // UI gating mirrors the server's role checks (member.* and invite.create
  // require owner; share.create requires editor) — non-owners used to see a
  // wall of controls that could only ever 403.
  const me = trpc.member.me.useQuery({ baseId });
  const isOwner = me.data?.role === 'owner';
  const isEditor = isOwner || me.data?.role === 'editor';
  useBreadcrumbSetter([{ label: 'Members' }]);

  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; token: string } | null>(null);
  // Self role changes route through a confirm dialog — with other owners
  // present the server allows the demotion, so the consequence is made
  // explicit before it lands.
  const [selfRoleTarget, setSelfRoleTarget] = useState<{
    userId: string;
    label: string;
    role: 'owner' | 'editor' | 'viewer';
  } | null>(null);

  const updateRole = trpc.member.updateRole.useMutation({
    onSuccess: () => utils.member.list.invalidate({ baseId }),
    onError: (err) => toast.error(err.message),
  });
  const removeMember = trpc.member.remove.useMutation({
    onSuccess: () => {
      setRemoveTarget(null);
      utils.member.list.invalidate({ baseId });
    },
    onError: (err) => toast.error(err.message),
  });
  const createShare = trpc.share.create.useMutation({
    onSuccess: (row) => {
      void utils.share.list.invalidate({ baseId });
      toast.success('Share link created');
      copyToClipboard(`${window.location.origin}/share/${row.token}`, 'Link copied');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteShare = trpc.share.delete.useMutation({
    onSuccess: () => {
      setShareTarget(null);
      void utils.share.list.invalidate({ baseId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (members.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded bg-muted"
            role="status"
            aria-label="Loading members"
          />
        ))}
      </div>
    );
  }

  if (members.isError) {
    return (
      <div className="space-y-1 text-sm" role="alert">
        <p className="text-destructive">Failed to load members.</p>
        <button
          onClick={() => void utils.member.list.invalidate({ baseId })}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Retry
        </button>
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
            const isSelf = session?.user?.id === m.userId;
            return (
              <li key={m.userId} className="flex items-center gap-3 border-b border-border py-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-xs">
                  {initials(label) || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {m.name ?? m.email ?? m.userId}
                    {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                  </div>
                  {m.name && m.email && (
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  )}
                </div>
                {isOwner && (
                  <Select
                    value={m.role}
                    onValueChange={(v) => {
                      if (!v) return;
                      const role = v as 'owner' | 'editor' | 'viewer';
                      if (isSelf) {
                        setSelfRoleTarget({ userId: m.userId, label, role });
                        return;
                      }
                      updateRole.mutate({ baseId, userId: m.userId, role });
                    }}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">{m.role}</SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">owner</SelectItem>
                      <SelectItem value="editor">editor</SelectItem>
                      <SelectItem value="viewer">viewer</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {!isOwner && (
                  <span className="w-24 text-right text-xs text-muted-foreground">{m.role}</span>
                )}
                {isOwner && !isSelf && (
                  <button
                    onClick={() => setRemoveTarget({ userId: m.userId, label })}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Public share links</h2>
          {isEditor && (
            <button
              onClick={() => createShare.mutate({ baseId })}
              disabled={createShare.isPending}
              className="h-7 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              + create link
            </button>
          )}
        </div>
        {shares.isLoading && shares.data === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : shares.data && shares.data.length > 0 ? (
          <ul className="border-t border-border">
            {shares.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <code className="block truncate text-xs text-muted-foreground">
                    /share/{s.token}
                  </code>
                  {/* New links carry a bounded lifetime (default 90 days); */}
                  {/* legacy rows with a null expiresAt never expire. */}
                  <span className="text-[10px] text-muted-foreground">
                    {isExpired(s.expiresAt)
                      ? 'expired'
                      : s.expiresAt
                        ? `expires ${new Date(s.expiresAt).toLocaleDateString()}`
                        : 'no expiry'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    copyToClipboard(`${window.location.origin}/share/${s.token}`, 'Link copied');
                  }}
                  className="text-xs hover:text-foreground"
                >
                  copy
                </button>
                {isEditor && (
                  <button
                    onClick={() => setShareTarget({ id: s.id, token: s.token })}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    delete
                  </button>
                )}
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
        <InviteSection canInvite={isOwner} />
      </section>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.label ?? ''}?`}
        description="They immediately lose access to this base. Their past edits and history stay."
        confirmLabel="Remove member"
        pending={removeMember.isPending}
        onConfirm={() =>
          removeTarget && removeMember.mutate({ baseId, userId: removeTarget.userId })
        }
      />

      <ConfirmDialog
        open={shareTarget !== null}
        onOpenChange={(o) => !o && setShareTarget(null)}
        title="Delete this share link?"
        description="Everyone holding the link — and any RSS subscribers of its feed — loses access immediately. This cannot be undone."
        confirmLabel="Delete link"
        pending={deleteShare.isPending}
        onConfirm={() => shareTarget && deleteShare.mutate({ id: shareTarget.id })}
      />

      <ConfirmDialog
        open={selfRoleTarget !== null}
        onOpenChange={(o) => !o && setSelfRoleTarget(null)}
        title={`Change your own role to ${selfRoleTarget?.role ?? ''}?`}
        description="You may lose owner access to this base. Another owner would have to restore it."
        confirmLabel="Change my role"
        pending={updateRole.isPending}
        onConfirm={() => {
          if (selfRoleTarget) {
            updateRole.mutate({ baseId, userId: selfRoleTarget.userId, role: selfRoleTarget.role });
          }
          setSelfRoleTarget(null);
        }}
      />
    </div>
  );
}
