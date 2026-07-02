'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsTabs } from '@/components/settings-tabs';
import { trpc } from '@/lib/trpc/client';

export default function BaseSettingsLayout({ children }: { children: ReactNode }) {
  const { baseId } = useParams<{ baseId: string }>();
  const { data: base } = trpc.base.get.useQuery({ id: baseId });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{base?.name ?? 'Base'}</h1>
      </div>
      <SettingsTabs baseId={baseId} />
      <div className="mx-auto max-w-3xl px-6 py-6">{children}</div>
    </div>
  );
}
