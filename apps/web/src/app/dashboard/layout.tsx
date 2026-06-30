import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { api } from '@/server/trpc/caller';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const caller = await api();
  const session = await caller.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b p-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="font-bold">markpocket</span>
          <span className="text-sm text-gray-600">{session.user.email}</span>
        </div>
      </nav>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}
