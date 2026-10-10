'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';
import { PUBLIC_FORM_TYPES, formConfigSchema, type FormConfig } from '@/lib/form-config';
import { PublicForm, type PublicFormConfig } from './public-form';

type Field = Omit<PublicFormConfig['fields'][number], 'required'>;
export function FormBuilder({
  viewId,
  tableId,
  readOnly,
  isOwner = false,
}: {
  viewId: string;
  tableId: string;
  readOnly: boolean;
  isOwner?: boolean;
}) {
  const views = trpc.view.list.useQuery({ tableId });
  const fields = trpc.field.list.useQuery({ tableId });
  if (views.isLoading || fields.isLoading)
    return (
      <p role="status" className="p-4">
        Loading form…
      </p>
    );
  if (views.isError || fields.isError)
    return (
      <div role="alert" className="p-4">
        Unable to load form.{' '}
        <Button
          onClick={() => {
            void views.refetch();
            void fields.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  const view = views.data?.find((v) => v.id === viewId);
  if (!view) return <p className="p-4">Form is unavailable.</p>;
  return (
    <Builder
      key={viewId}
      viewId={viewId}
      tableId={tableId}
      options={view.options as Record<string, unknown>}
      fields={(fields.data ?? []) as Field[]}
      readOnly={readOnly}
      isOwner={isOwner}
    />
  );
}

function Builder({
  viewId,
  tableId,
  options,
  fields,
  readOnly,
  isOwner,
}: {
  viewId: string;
  tableId: string;
  options: Record<string, unknown>;
  fields: Field[];
  readOnly: boolean;
  isOwner: boolean;
}) {
  const parsed = formConfigSchema.safeParse(options.form);
  const [config, setConfig] = useState<FormConfig>(
    parsed.success
      ? parsed.data
      : {
          title: 'New form',
          description: '',
          fields: [],
          successMessage: 'Thank you. Your response has been received.',
        },
  );
  const [dirty, setDirty] = useState(false);
  const [days, setDays] = useState(30);
  const [url, setUrl] = useState('');
  const [confirm, setConfirm] = useState<'rotate' | string | null>(null);
  const utils = trpc.useUtils();
  const publications = trpc.form.list.useQuery({ viewId }, { enabled: isOwner });
  const save = trpc.view.updateOptions.useMutation({
    onSuccess: () => {
      setDirty(false);
      setUrl('');
      toast.success(
        'Form saved. Field changes invalidate published links; publish again if needed.',
      );
      void utils.view.list.invalidate({ tableId });
      void utils.form.list.invalidate({ viewId });
    },
    onError: (err) => toast.error(err.message),
  });
  const publish = trpc.form.publish.useMutation({
    onSuccess: (result) => {
      setUrl(`${window.location.origin}/forms/${result.token}`);
      setConfirm(null);
      void utils.form.list.invalidate({ viewId });
    },
    onError: (err) => toast.error(err.message),
  });
  const revoke = trpc.form.revoke.useMutation({
    onSuccess: () => {
      setConfirm(null);
      setUrl('');
      void utils.form.list.invalidate({ viewId });
    },
    onError: (err) => toast.error(err.message),
  });
  function update(next: FormConfig) {
    setConfig(next);
    setDirty(true);
  }
  const selected = config.fields.map((entry) => ({
    ...fields.find((f) => f.id === entry.fieldId),
    ...entry,
  }));
  const invalid = selected.some((f) => !f.id || !PUBLIC_FORM_TYPES.has(f.type ?? ''));
  const preview: PublicFormConfig = {
    ...config,
    fields: selected
      .filter((f) => f.id && PUBLIC_FORM_TYPES.has(f.type ?? ''))
      .map((f) => ({
        id: f.id!,
        name: f.name!,
        type: f.type!,
        options: f.options!,
        required: f.required,
      })),
  };
  const active = publications.data?.find(
    (p) => !p.revokedAt && new Date(p.expiresAt).getTime() > Date.now(),
  );
  if (readOnly)
    return (
      <div className="overflow-auto">
        <p className="px-4 pt-4 text-sm text-muted-foreground">Form preview</p>
        {!parsed.success || invalid ? (
          <p className="p-4">This form needs configuration.</p>
        ) : (
          <PublicForm token="" config={preview} preview />
        )}
      </div>
    );
  return (
    <div className="overflow-auto p-4">
      <fieldset
        disabled={save.isPending || publish.isPending || revoke.isPending}
        className="mx-auto max-w-3xl space-y-5"
      >
        <h2 className="text-xl font-semibold">Form builder</h2>
        <p className="text-sm text-muted-foreground">
          Only selected fields are public. Changing selected fields or required settings invalidates
          published links.
        </p>
        <label className="block space-y-1">
          Title
          <Input
            value={config.title}
            maxLength={120}
            onChange={(e) => update({ ...config, title: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          Description
          <textarea
            className="w-full rounded-md border border-border bg-background p-2"
            maxLength={2000}
            value={config.description}
            onChange={(e) => update({ ...config, description: e.target.value })}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="font-medium">Public fields (up to 50)</legend>
          {fields
            .filter((f) => PUBLIC_FORM_TYPES.has(f.type))
            .map((field) => (
              <label key={field.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.fields.some((f) => f.fieldId === field.id)}
                  disabled={
                    !config.fields.some((f) => f.fieldId === field.id) && config.fields.length >= 50
                  }
                  onChange={(e) =>
                    update({
                      ...config,
                      fields: e.target.checked
                        ? [...config.fields, { fieldId: field.id, required: false }]
                        : config.fields.filter((f) => f.fieldId !== field.id),
                    })
                  }
                />
                {field.name} <span className="text-xs text-muted-foreground">{field.type}</span>
              </label>
            ))}
        </fieldset>
        <ol className="space-y-2">
          {selected.map((field, index) => (
            <li
              key={field.fieldId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
            >
              <span className="min-w-0 flex-1 break-words">
                {field.name ?? 'Unavailable field'}
              </span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) =>
                    update({
                      ...config,
                      fields: config.fields.map((f) =>
                        f.fieldId === field.fieldId ? { ...f, required: e.target.checked } : f,
                      ),
                    })
                  }
                />
                {field.type === 'boolean' ? 'Must be checked' : 'Required'}
              </label>
              {(['Up', 'Down'] as const).map((direction) => (
                <Button
                  key={direction}
                  size="sm"
                  variant="outline"
                  aria-label={`Move ${field.name ?? 'unavailable field'} ${direction.toLowerCase()}`}
                  disabled={direction === 'Up' ? index === 0 : index === selected.length - 1}
                  onClick={() => {
                    const next = [...config.fields];
                    const target = index + (direction === 'Up' ? -1 : 1);
                    [next[index], next[target]] = [next[target]!, next[index]!];
                    update({ ...config, fields: next });
                  }}
                >
                  {direction}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${field.name ?? 'unavailable field'}`}
                onClick={() =>
                  update({
                    ...config,
                    fields: config.fields.filter((f) => f.fieldId !== field.fieldId),
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
        {invalid && (
          <p role="alert">A selected field is unavailable. Remove it and save before publishing.</p>
        )}
        <label className="block space-y-1">
          Success message
          <Input
            maxLength={500}
            value={config.successMessage}
            onChange={(e) => update({ ...config, successMessage: e.target.value })}
          />
        </label>
        <Button
          disabled={save.isPending || invalid || !dirty}
          onClick={() => {
            const valid = formConfigSchema.safeParse(config);
            if (!valid.success) {
              toast.error('Enter a title, success message and 1–50 public fields.');
              return;
            }
            save.mutate({ id: viewId, options: { ...options, form: valid.data } });
          }}
        >
          Save form
        </Button>
        {isOwner && (
          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="font-medium">Submission link</h3>
            <label className="block space-y-1">
              Expires in days (1–365)
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <Button
              disabled={
                dirty ||
                invalid ||
                !parsed.success ||
                publish.isPending ||
                !Number.isInteger(days) ||
                days < 1 ||
                days > 365 ||
                publications.isLoading ||
                publications.isError
              }
              onClick={() =>
                active ? setConfirm('rotate') : publish.mutate({ viewId, expiresInDays: days })
              }
            >
              {active ? 'Rotate link' : 'Publish'}
            </Button>
            {dirty && <p className="text-sm">Save changes before publishing.</p>}
            {url && (
              <div className="space-y-2">
                <p className="text-sm">
                  Copy this link now. The full link is shown only this time.
                </p>
                <Input aria-label="New submission link" readOnly value={url} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(url).then(
                      () => toast.success('Link copied'),
                      () => toast.error('Copy failed. Select and copy the link.'),
                    );
                  }}
                >
                  Copy link
                </Button>
              </div>
            )}
            {publications.isError && (
              <p role="alert">
                Unable to load publication status.{' '}
                <Button onClick={() => void publications.refetch()}>Retry</Button>
              </p>
            )}
            {publications.data?.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  {p.prefix}… · Expires {new Date(p.expiresAt).toLocaleString()} ·{' '}
                  {p.revokedAt
                    ? 'Revoked'
                    : new Date(p.expiresAt).getTime() <= Date.now()
                      ? 'Expired'
                      : 'Active'}
                </span>
                {!p.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => setConfirm(p.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
        <section className="border-t border-border pt-4">
          <h3 className="font-medium">Preview</h3>
          <PublicForm key={JSON.stringify(config)} token="" config={preview} preview />
        </section>
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirm === 'rotate' ? 'Rotate submission link?' : 'Revoke submission link?'}
          description="The previous link will stop accepting submissions."
          confirmLabel={confirm === 'rotate' ? 'Rotate link' : 'Revoke'}
          pending={publish.isPending || revoke.isPending}
          onConfirm={() => {
            if (confirm === 'rotate') publish.mutate({ viewId, expiresInDays: days });
            else if (confirm) revoke.mutate({ publicationId: confirm });
          }}
        />
      </fieldset>
    </div>
  );
}
