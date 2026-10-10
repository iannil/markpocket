import type { Metadata } from 'next';

import { baseName } from '@/lib/base-meta';
import { api } from '@/server/trpc/caller';

import { TableView } from './table-view';

// The tables layout only knows the baseId (its params stop there), so it
// titles the page "Base · table". This page has both ids and overrides with
// the actual table name via table.get — one row lookup, not the whole
// table.list.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}): Promise<Metadata> {
  const { baseId, tableId } = await params;
  const [base, caller] = await Promise.all([baseName(baseId), api()]);
  let tableName: string | null = null;
  try {
    tableName = (await caller.table.get({ id: tableId })).name;
  } catch {
    // Unauthenticated or no membership — the page itself handles rejection.
  }
  if (base == null && tableName == null) return {};
  return { title: `${base ?? 'Base'} · ${tableName ?? 'table'}` };
}

export default async function TableGridPage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}) {
  const { baseId, tableId } = await params;
  // key={tableId}: navigating between tables reuses this page component, and
  // TableView's selection and the renderer state must not survive the switch.
  return <TableView key={tableId} baseId={baseId} tableId={tableId} />;
}
