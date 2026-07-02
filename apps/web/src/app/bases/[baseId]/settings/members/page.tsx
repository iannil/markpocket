'use client';

import { useParams } from 'next/navigation';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';

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
    onSuccess: () => utils.share.list.invalidate({ baseId }),
  });
  const deleteShare = trpc.share.delete.useMutation({
    onSuccess: () => utils.share.list.invalidate({ baseId }),
  });

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
                    if (confirm(`移除 ${label}?`))
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
        {shares.data && shares.data.length > 0 ? (
          <ul className="border-t border-border">
            {shares.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <code className="flex-1 truncate text-xs text-muted-foreground">
                  /share/{s.token}
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(`${window.location.origin}/share/${s.token}`)
                  }
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
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Invite</h2>
        <p className="text-xs text-muted-foreground">邀请功能待后端支持。</p>
      </section>
    </div>
  );
}
