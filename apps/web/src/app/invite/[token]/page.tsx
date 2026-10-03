// apps/web/src/app/invite/[token]/page.tsx
import type { Metadata } from 'next';
import { cache } from 'react';

import { api } from '@/server/trpc/caller';
import { InviteView } from './invite-view';

// Shared between generateMetadata and the page render (request-scoped cache).
const resolveInvite = cache(async (token: string) => {
  try {
    return await (await api()).invite.resolve({ token });
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const inv = await resolveInvite(token);
  // noindex: the tokenized URL must not end up in search indexes.
  return { title: inv ? `Invite · ${inv.baseName}` : 'Invite', robots: { index: false } };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteView token={token} inv={await resolveInvite(token)} />;
}
