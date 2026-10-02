import type { Metadata } from 'next';

import { baseName } from '@/lib/base-meta';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string }>;
}): Promise<Metadata> {
  const { baseId } = await params;
  const name = (await baseName(baseId)) ?? 'Base';
  return { title: `History · ${name}` };
}

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
