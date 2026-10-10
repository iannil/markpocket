'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { getPublicForm } from '@/server/forms/submission';

export type PublicFormConfig = Awaited<ReturnType<typeof getPublicForm>>;
type Value = string | number | boolean | string[];
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function PublicForm({
  token,
  config,
  preview = false,
}: {
  token: string;
  config: PublicFormConfig;
  preview?: boolean;
}) {
  const [values, setValues] = useState<Record<string, Value>>({});
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [attempt, setAttempt] = useState<{ body: string; startedAt: number } | null>(null);
  const [needsNew, setNeedsNew] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function change(id: string, value: Value) {
    setValues((old) => ({ ...old, [id]: value }));
    if (attempt) setNeedsNew(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || preview) return;
    const confirmed = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'new';
    if (needsNew && !confirmed) return;
    if (attempt && !confirmed && Date.now() - attempt.startedAt >= RETRY_WINDOW_MS) {
      setNeedsNew(true);
      setError(
        'The seven-day retry window has expired. Your earlier response may already have been received.',
      );
      return;
    }
    const cells: Record<string, Value> = {};
    for (const field of config.fields) {
      const value = values[field.id];
      if (field.type === 'boolean') cells[field.id] = value === true;
      else if (value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)) {
        cells[field.id] = field.type === 'number' ? Number(value) : value;
      }
    }
    const nextAttempt =
      attempt && !confirmed
        ? attempt
        : {
            body: JSON.stringify({ requestId: crypto.randomUUID(), cells }),
            startedAt: Date.now(),
          };
    const { body } = nextAttempt;
    setAttempt(nextAttempt);
    setNeedsNew(false);
    sending.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!response.ok) {
        if (response.status === 409) {
          setNeedsNew(true);
          throw Error(
            'This submission cannot be safely retried. Confirm a new submission only if you want another response.',
          );
        }
        throw Error(
          response.status === 429
            ? 'Too many submissions. Try again shortly.'
            : 'Submission failed. Check the form and retry.',
        );
      }
      const result = await response.json();
      if (result.ok !== true)
        throw Error('The response could not be confirmed. Retry to check the same submission.');
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== 'network'
          ? err.message
          : 'The response could not be confirmed. Retry to check the same submission.',
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  if (submitted)
    return (
      <p role="status" className="py-8 text-lg">
        {config.successMessage}
      </p>
    );
  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">{config.title}</h1>
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{config.description}</p>
      </div>
      <fieldset disabled={pending || preview} className="space-y-5">
        {config.fields.map((field) => {
          const id = `form-${field.id}`;
          const options = field.options as Record<string, unknown>;
          const choices = (options.choices ?? []) as { id: string; name: string }[];
          const label =
            field.type === 'boolean' && field.required
              ? `${field.name} (must be checked)`
              : field.name;
          return (
            <div key={field.id} className="space-y-2">
              <label htmlFor={id} className="block text-sm font-medium">
                {label}
              </label>
              {field.type === 'single-select' || field.type === 'multi-select' ? (
                <select
                  id={id}
                  required={field.required}
                  multiple={field.type === 'multi-select'}
                  value={
                    (values[field.id] as string | string[]) ??
                    (field.type === 'multi-select' ? [] : '')
                  }
                  onChange={(e) =>
                    change(
                      field.id,
                      field.type === 'multi-select'
                        ? Array.from(e.target.selectedOptions, (o) => o.value)
                        : e.target.value,
                    )
                  }
                  className="w-full rounded-md border border-border bg-background p-2"
                >
                  {field.type === 'single-select' && <option value="">Choose an option</option>}
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              ) : field.type === 'boolean' ? (
                <input
                  id={id}
                  type="checkbox"
                  required={field.required}
                  checked={values[field.id] === true}
                  onChange={(e) => change(field.id, e.target.checked)}
                  className="size-4"
                />
              ) : (
                <input
                  id={id}
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'date'
                        ? options.includeTime
                          ? 'datetime-local'
                          : 'date'
                        : 'text'
                  }
                  step={field.type === 'number' ? 'any' : undefined}
                  required={field.required}
                  value={(values[field.id] as string) ?? ''}
                  onChange={(e) => change(field.id, e.target.value)}
                  className="w-full rounded-md border border-border bg-background p-2"
                />
              )}
              {field.required && field.type !== 'boolean' && (
                <p className="text-xs text-muted-foreground">Required</p>
              )}
            </div>
          );
        })}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {needsNew && (
        <p className="text-sm">
          Your earlier response may already have been received. A new submission can create another
          response.
        </p>
      )}
      <Button type="submit" value={needsNew ? 'new' : 'retry'} disabled={pending || preview}>
        {pending
          ? 'Submitting…'
          : needsNew
            ? 'Confirm new submission'
            : attempt
              ? 'Retry'
              : 'Submit'}
      </Button>
    </form>
  );
}
