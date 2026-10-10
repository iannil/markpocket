// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FieldLike } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { BoardSettings } from './board-settings';

const state = vi.hoisted(() => ({ write: vi.fn(), invalidate: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ view: { list: { invalidate: state.invalidate } } }),
    view: {
      updateOptions: { useMutation: () => ({ mutateAsync: state.write, isPending: false }) },
    },
  },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: state.error } }));
const fields: FieldLike[] = [
  {
    id: 'status',
    name: 'Status',
    type: 'single-select',
    options: { choices: [{ id: 'todo', name: 'Todo', color: 'blue' }] },
  },
  {
    id: 'other-status',
    name: 'Other status',
    type: 'single-select',
    options: { choices: [{ id: 'open', name: 'Open', color: 'blue' }] },
  },
  { id: 'title', name: 'Title', type: 'text', options: {} },
  { id: 'other-title', name: 'Other title', type: 'text', options: {} },
];
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.write.mockReset();
  state.invalidate.mockResolvedValue(undefined);
});
const settings = (onSaved: () => void) => (
  <BoardSettings
    tableId="t1"
    viewId="v1"
    fields={fields}
    options={{ kanban: { groupFieldId: 'status', titleFieldId: 'title' } }}
    onSaved={onSaved}
    onEditing={vi.fn()}
  />
);

it('locks configuration and discard through a deferred save so the submitted draft cannot be replaced', async () => {
  let resolve!: () => void;
  let refresh!: () => void;
  state.invalidate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        refresh = done;
      }),
  );
  state.write.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const saved = vi.fn();
  render(settings(saved));
  const status = screen.getByLabelText('Status field') as HTMLSelectElement;
  const title = screen.getByLabelText('Title field') as HTMLSelectElement;
  fireEvent.change(title, { target: { value: 'other-title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save board' }));
  const discard = screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;
  expect(status.disabled).toBe(true);
  expect(title.disabled).toBe(true);
  expect(discard.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Save board' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  // Synthetic changes also exercise the synchronous exclusion guard while the
  // mutation hook has not yet reported isPending.
  fireEvent.change(status, { target: { value: 'other-status' } });
  fireEvent.change(title, { target: { value: 'title' } });
  fireEvent.click(discard);
  expect(status.value).toBe('status');
  expect(title.value).toBe('other-title');
  expect(state.write).toHaveBeenCalledExactlyOnceWith({
    id: 'v1',
    options: { kanban: { groupFieldId: 'status', titleFieldId: 'other-title' } },
  });
  expect(saved).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(status.disabled).toBe(true);
  expect(title.disabled).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  await act(async () => refresh());
  expect(saved).toHaveBeenCalledOnce();
  expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ tableId: 't1' });
  expect(status.disabled).toBe(false);
  expect(title.disabled).toBe(false);
});
it('restores editable controls and retains the submitted draft after rejection', async () => {
  let reject!: (error: Error) => void;
  state.write.mockImplementation(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  const saved = vi.fn();
  render(settings(saved));
  const title = screen.getByLabelText('Title field') as HTMLSelectElement;
  fireEvent.change(title, { target: { value: 'other-title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save board' }));
  expect(title.disabled).toBe(true);
  await act(async () => reject(new Error('Save failed')));
  expect(title.disabled).toBe(false);
  expect(title.value).toBe('other-title');
  expect(
    (screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(screen.getByRole('alert').textContent).toBe('Save failed');
  expect(saved).not.toHaveBeenCalled();
  expect(state.invalidate).not.toHaveBeenCalled();
});
