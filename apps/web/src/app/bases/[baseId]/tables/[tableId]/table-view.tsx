'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ViewTabs } from '@/components/view-config/view-tabs';
import { trpc } from '@/lib/trpc/client';
import { formConfigSchema } from '@/lib/form-config';
import type { FieldLike } from './cell-renderers';
import { GridEditor } from './grid-editor';

interface ViewLike {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
}

export function TableView({ baseId, tableId }: { baseId: string; tableId: string }) {
  const utils = trpc.useUtils();
  const fieldsQuery = trpc.field.list.useQuery({ tableId });
  const viewsQuery = trpc.view.list.useQuery({ tableId });
  const { data: membership } = trpc.member.me.useQuery({ baseId });
  const fields = useMemo(() => (fieldsQuery.data ?? []) as FieldLike[], [fieldsQuery.data]);
  const views = useMemo(() => (viewsQuery.data ?? []) as ViewLike[], [viewsQuery.data]);
  const readOnly = membership?.role !== 'owner' && membership?.role !== 'editor';
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  // Resolve during render so Grid never issues a view-less records query, and
  // a remotely deleted selection immediately falls back to the first view.
  const activeViewId =
    selectedViewId && views.some((view) => view.id === selectedViewId)
      ? selectedViewId
      : (views[0]?.id ?? null);
  const activeView = views.find((view) => view.id === activeViewId);

  if (fieldsQuery.isLoading || viewsQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Loading views…
      </div>
    );
  }
  if (fieldsQuery.isError || viewsQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
        <div>
          {fieldsQuery.isError ? 'Failed to load fields.' : 'Failed to load views.'} Please try
          again.
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void utils.field.list.invalidate({ tableId });
            void utils.view.list.invalidate({ tableId });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none px-4 pt-4">
        <ViewTabs
          tableId={tableId}
          views={views}
          activeViewId={activeViewId}
          onSelect={setSelectedViewId}
          readOnly={readOnly}
        />
      </div>
      {activeView?.type === 'grid' ? (
        <GridEditor
          baseId={baseId}
          tableId={tableId}
          viewId={activeView.id}
          fields={fields}
          viewName={activeView.name}
          options={activeView.options}
          readOnly={readOnly}
        />
      ) : (
        <div role="status" className="p-4 text-sm text-muted-foreground">
          {activeView?.type === 'form'
            ? formConfigSchema.safeParse(activeView.options.form).success
              ? 'Form rendering is not available yet.'
              : 'This form needs configuration.'
            : activeView
              ? 'This view type is not available yet.'
              : 'No views.'}
        </div>
      )}
    </div>
  );
}
