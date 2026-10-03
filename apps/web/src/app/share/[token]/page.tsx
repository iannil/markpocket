// apps/web/src/app/share/[token]/page.tsx
import type { Metadata } from 'next';
import { cache } from 'react';

import { api } from '@/server/trpc/caller';
import { ShareView } from './share-view';

// cache(): generateMetadata and the page body both call loadShare — without
// it every request ran the token/base/tables queries twice. Errors
// propagate (no catch): a DB outage must reach the error boundary instead
// of masquerading as "link expired" — an invalid token is a null baseInfo,
// not a throw.
const loadShare = cache(async (token: string) => {
  const caller = await api();
  const [baseInfo, tables] = await Promise.all([
    caller.publicShare.getBase({ token }),
    caller.publicShare.getTables({ token }),
  ]);
  return { baseInfo, tables };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { baseInfo } = await loadShare(token);
  const title = baseInfo ? `${baseInfo.name} · shared` : 'Shared base';
  // The URL carries the secret — it must never be indexed or cached by
  // crawlers. No record data in the description on principle.
  return {
    title,
    robots: { index: false, follow: false },
    openGraph: baseInfo ? { title, siteName: 'markpocket' } : undefined,
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const initial = await loadShare(token);
  return <ShareView token={token} initial={initial} />;
}
