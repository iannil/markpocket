'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export function SettingsTabs({ baseId }: { baseId: string }) {
  const pathname = usePathname();
  const root = `/bases/${baseId}/settings`;
  const tabs = [
    { label: 'Tables', href: root },
    { label: 'Members', href: `${root}/members` },
    { label: 'Settings', href: `${root}/general` },
    { label: 'History', href: `${root}/history` },
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
