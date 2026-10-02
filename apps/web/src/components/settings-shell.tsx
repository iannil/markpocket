// apps/web/src/components/settings-shell.tsx
'use client';

import type { ReactNode } from 'react';

import { SettingsTabs } from '@/components/settings-tabs';
import { useBaseInfo } from '@/components/base-context';

export function SettingsShell({ baseId, children }: { baseId: string; children: ReactNode }) {
  const info = useBaseInfo();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{info?.baseName ?? 'Base'}</h1>
      </div>
      <SettingsTabs baseId={baseId} />
      <div className="mx-auto max-w-3xl px-6 py-6">{children}</div>
    </div>
  );
}
