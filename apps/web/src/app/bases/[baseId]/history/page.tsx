'use client';

import { BaseHistoryList } from '@/components/base-history-list';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';

export default function BaseHistoryPage() {
  useBreadcrumbSetter([{ label: 'History' }]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">History</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All changes across this base, newest first.
      </p>
      <div className="mt-6">
        <BaseHistoryList />
      </div>
    </div>
  );
}
