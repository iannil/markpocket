// apps/web/src/app/share/[token]/page.tsx
import type { Metadata } from 'next';

import { api } from '@/server/trpc/caller';
import { ShareView } from './share-view';

async function loadShare(token: string) {
  try {
    const caller = await api();
    const [baseInfo, tables] = await Promise.all([
      caller.publicShare.getBase({ token }),
      caller.publicShare.getTables({ token }),
    ]);
    return { baseInfo, tables };
  } catch {
    return { baseInfo: null, tables: [] as { id: string; name: string }[] };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { baseInfo } = await loadShare(token);
  return { title: baseInfo ? `${baseInfo.name} · shared` : 'Shared base' };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const initial = await loadShare(token);
  return <ShareView token={token} initial={initial} />;
}
