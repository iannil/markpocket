'use client';

import { usePresence } from './realtime-provider';

export function PresenceBar({ baseId }: { baseId: string }) {
  const users = usePresence(baseId);
  if (users.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">online:</span>
      {users.map((u) => (
        <span
          key={u.userId}
          className="rounded-full border px-2 py-0.5 text-xs"
          title={u.userEmail}
        >
          {u.userName || u.userEmail}
        </span>
      ))}
    </div>
  );
}
