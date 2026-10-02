import type { Metadata } from 'next';

import { SettingsShell } from '@/components/settings-shell';
import { baseName } from '@/lib/base-meta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string }>;
}): Promise<Metadata> {
  const { baseId } = await params;
  const name = (await baseName(baseId)) ?? 'Base';
  return { title: `Settings · ${name}` };
}

export default async function BaseSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ baseId: string }>;
}) {
  const { baseId } = await params;
  return <SettingsShell baseId={baseId}>{children}</SettingsShell>;
}
