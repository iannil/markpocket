'use client';

import { BaseHistoryList } from '@/components/base-history-list';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';

// Rendered inside the settings tabs — no redirect out of the tab layout.
export default function HistoryTab() {
  useBreadcrumbSetter([{ label: 'History' }]);

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        All changes across this base, newest first.
      </p>
      <BaseHistoryList />
    </div>
  );
}
