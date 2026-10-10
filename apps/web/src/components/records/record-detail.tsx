'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LinkTablesProvider } from '@/app/bases/[baseId]/tables/[tableId]/link-cell';
import type { FieldLike } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';
import { RecordFieldEditor } from './record-field-editor';

type Props = { tableId: string; recordId: string; readOnly: boolean; onClose: () => void };

export function RecordDetail(props: Props) {
  return <DetailSession key={`${props.tableId}:${props.recordId}`} {...props} />;
}

function DetailSession({ tableId, recordId, readOnly, onClose }: Props) {
  const record = trpc.record.get.useQuery({ tableId, id: recordId });
  const fields = trpc.field.list.useQuery({ tableId });
  const table = trpc.table.get.useQuery({ id: tableId });
  const baseId = table.data?.baseId ?? '';
  const member = trpc.member.me.useQuery({ baseId }, { enabled: !!baseId });
  const members = trpc.member.list.useQuery({ baseId }, { enabled: !!baseId });
  const upsert = trpc.cell.upsert.useMutation();
  const utils = trpc.useUtils();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const locked = readOnly || !['owner', 'editor'].includes(member.data?.role ?? '');
  async function save(fieldId: string, value: unknown) {
    if (locked) throw new Error('This record is read-only');
    const result = await upsert.mutateAsync({ recordId, fieldId, value });
    // These scopes belong to the committed write even if the user closed or
    // changed records. Only feedback belongs to this mounted detail session.
    await Promise.all([
      utils.record.get.invalidate({ tableId, id: recordId }),
      utils.record.kanbanPage.invalidate({ tableId }),
      utils.record.groupCounts.invalidate({ tableId }),
      utils.record.list.invalidate({ tableId }),
    ]);
    if (mounted.current && result?.overwroteRecentBy?.userId) {
      const id = result.overwroteRecentBy.userId;
      const name = members.data?.find((user) => user.userId === id)?.name ?? id.slice(0, 8);
      toast.info(`Overwrote a recent edit by ${name}`);
    }
  }
  const linkTargets = useMemo(
    () => [
      ...new Set(
        (fields.data ?? [])
          .filter((field) => field.type === 'link')
          .map((field) => (field.options as Record<string, unknown>).targetTableId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ],
    [fields.data],
  );
  const users = (members.data ?? []).map((user) => ({
    id: user.userId,
    name: user.name,
    email: user.email,
  }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 content-start rounded-none sm:max-w-lg">
        <DialogTitle>Record details</DialogTitle>
        <DialogDescription>{locked ? 'Read-only record' : 'Edit record fields'}</DialogDescription>
        {(record.isLoading || fields.isLoading) && <p role="status">Loading record…</p>}
        {(record.isError || fields.isError || table.isError) && (
          <div role="alert">
            Unable to load record.{' '}
            <Button
              onClick={() => {
                void record.refetch();
                void fields.refetch();
                void table.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {record.data && fields.data && !record.isError && !fields.isError && (
          <LinkTablesProvider tableIds={linkTargets}>
            <div className="space-y-5">
              {(fields.data as FieldLike[]).map((field) => (
                <RecordFieldEditor
                  key={`${field.id}:${locked}:${JSON.stringify(field)}`}
                  field={field}
                  record={record.data}
                  users={users}
                  baseId={baseId}
                  readOnly={locked}
                  onSave={save}
                />
              ))}
            </div>
          </LinkTablesProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}
