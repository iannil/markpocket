import type { Metadata } from 'next';

import { BaseContextProvider } from '@/components/base-context';
import { baseName } from '@/lib/base-meta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string }>;
}): Promise<Metadata> {
  const { baseId } = await params;
  return { title: (await baseName(baseId)) ?? 'Base' };
}

export default async function BaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ baseId: string }>;
}) {
  const { baseId } = await params;
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <BaseContextProvider baseId={baseId}>{children}</BaseContextProvider>
      </div>
    </div>
  );
}
