// apps/web/src/components/online-avatars.tsx
'use client';

import { cn } from '@/lib/utils';

export type OnlineUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function OnlineAvatars({ users, max = 3 }: { users: OnlineUser[]; max?: number }) {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <div className="flex items-center -space-x-2">
      {visible.map((u) => {
        const hue = hashHue(u.id);
        return (
          <div
            key={u.id}
            className="relative size-5 rounded-full ring-1 ring-background overflow-hidden flex items-center justify-center text-[10px] font-medium text-white"
            style={{ background: u.avatarUrl ? undefined : `oklch(0.55 0.04 ${hue})` }}
            title={u.name}
          >
            {u.avatarUrl ? (
              <img src={u.avatarUrl} alt={u.name} className="size-full object-cover" />
            ) : (
              <span className="font-mono">{initials(u.name)}</span>
            )}
            <span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-online ring-1 ring-background" />
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className={cn(
            'size-5 rounded-full ring-1 ring-background bg-muted flex items-center justify-center',
            'text-[10px] font-mono text-muted-foreground',
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
