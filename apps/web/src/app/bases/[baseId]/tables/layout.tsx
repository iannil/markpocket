import type { Metadata } from 'next';

import { baseName } from '@/lib/base-meta';

// Table-level metadata lives OUTSIDE tables/[tableId] (that directory is owned
// by the grid workstream). Layout params only expose baseId, so the best title
// available here is the base name; the grid page overrides it with the actual
// table name via its own generateMetadata.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string }>;
}): Promise<Metadata> {
  const { baseId } = await params;
  const name = (await baseName(baseId)) ?? 'Base';
  return { title: `${name} · table` };
}

export default function TablesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
