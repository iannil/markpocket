import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SidebarNav } from '@/components/sidebar-nav';
import { api } from '@/server/trpc/caller';

export default async function BasesLayout({ children }: { children: ReactNode }) {
  const caller = await api();
  const session = await caller.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
