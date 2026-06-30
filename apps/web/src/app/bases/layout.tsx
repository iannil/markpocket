import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { api } from '@/server/trpc/caller';

export default async function BasesLayout({ children }: { children: ReactNode }) {
  const caller = await api();
  const session = await caller.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b p-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/bases" className="font-bold">
            markpocket
          </Link>
          <span className="text-sm text-muted-foreground">{session.user.email}</span>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
