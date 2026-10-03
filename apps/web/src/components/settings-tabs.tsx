'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export function SettingsTabs({ baseId }: { baseId: string }) {
  const pathname = usePathname();
  const root = `/bases/${baseId}/settings`;
  const tabs = [
    // General first: renaming a base is the most common settings task and
    // was previously four tabs deep. Tables lives at its own sub-route.
    { label: 'General', href: `${root}/general` },
    { label: 'Tables', href: `${root}/tables` },
    { label: 'Members', href: `${root}/members` },
    { label: 'Agents', href: `${root}/agent` },
    { label: 'History', href: `${root}/history` },
    { label: 'Export', href: `${root}/export` },
  ];
  return (
    <nav className="flex gap-1 border-b border-border px-6">
      {tabs.map((t) => {
        const active = t.href === root ? pathname === root : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
