import type { Metadata } from 'next';

import { baseName } from '@/lib/base-meta';
import { api } from '@/server/trpc/caller';

import { GridEditor } from './grid-editor';

// The tables layout only knows the baseId (its params stop there), so it
// titles the page "Base · table". This page has both ids and overrides with
// the actual table name. tableRouter has no get-by-id, so the name comes from
// table.list filtered client-side of the caller — one indexed query per page
// view, RSC-cached per request.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}): Promise<Metadata> {
  const { baseId, tableId } = await params;
  const [base, caller] = await Promise.all([baseName(baseId), api()]);
  let table: string | null = null;
  try {
    const tables = await caller.table.list({ baseId });
    table = tables.find((t) => t.id === tableId)?.name ?? null;
  } catch {
    // Unauthenticated or no membership — the page itself handles rejection.
  }
  if (base == null && table == null) return {};
  return { title: `${base ?? 'Base'} · ${table ?? 'table'}` };
}

export default async function TableGridPage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}) {
  const { baseId, tableId } = await params;
  return <GridEditor baseId={baseId} tableId={tableId} />;
}
