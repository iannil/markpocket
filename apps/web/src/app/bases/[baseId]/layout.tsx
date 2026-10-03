import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { BaseContextProvider, type InitialBaseRow } from '@/components/base-context';
import { baseName } from '@/lib/base-meta';
import { auth } from '@/server/auth';
import { api } from '@/server/trpc/caller';

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

  // Server-side membership gate. The /bases parent layout redirects anonymous
  // visitors to /login, but layouts can render in parallel — check the session
  // here too instead of assuming the parent ran first. For an authenticated
  // non-member, base.get throws FORBIDDEN (same as a nonexistent base — no
  // existence oracle): render 404 rather than a full shell wrapping a
  // client-side error state.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');
  let initialBase: InitialBaseRow | null = null;
  try {
    const caller = await api();
    const row = await caller.base.get({ id: baseId });
    // Normalize createdAt to the wire format (ISO string) — the RSC caller
    // hands back the raw Date, and the row seeds the client-side query.
    initialBase = row ? { ...row, createdAt: new Date(row.createdAt).toISOString() } : null;
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <BaseContextProvider baseId={baseId} initialBase={initialBase}>
          {children}
        </BaseContextProvider>
      </div>
    </div>
  );
}
