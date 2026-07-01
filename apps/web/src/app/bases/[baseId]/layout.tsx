'use client';

import { useEffect, type ReactNode } from 'react';
import { useParams } from 'next/navigation';

import { PresenceBar } from '@/components/realtime/presence-bar';
import { useRealtime } from '@/components/realtime/realtime-provider';

export default function BaseLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ baseId: string }>();
  const baseId = params.baseId;
  const { subscribe, unsubscribe } = useRealtime();

  useEffect(() => {
    subscribe(baseId);
    return () => unsubscribe(baseId);
  }, [baseId, subscribe, unsubscribe]);

  return (
    <div className="space-y-2">
      <PresenceBar baseId={baseId} />
      {children}
    </div>
  );
}
