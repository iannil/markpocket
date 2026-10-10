// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FieldLike } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordDetail } from './record-detail';
const state = vi.hoisted(() => ({
  role: 'editor' as string | undefined,
  name: 'Original',
  fields: [
    { id: 'name', name: 'Name', type: 'text', options: {} },
    { id: 'computed', name: 'Computed', type: 'expression', options: {} },
    {
      id: 'status',
      name: 'Status',
      type: 'single-select',
      options: {
        choices: [
          { id: 'todo', name: 'Todo', color: 'blue' },
          { id: 'done', name: 'Done', color: 'green' },
        ],
      },
    },
    { id: 'flag', name: 'Flag', type: 'boolean', options: {} },
  ] as FieldLike[],
  write: vi.fn(),
  get: vi.fn(),
  page: vi.fn(),
  counts: vi.fn(),
  list: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useQueries: (fn: (query: unknown) => unknown[]) =>
      fn({
        field: { list: () => ({ data: [{ id: 'target-name', type: 'text' }], dataUpdatedAt: 1 }) },
        record: {
          list: () => ({
            data: {
              groups: [
                {
                  key: null,
                  records: [{ id: 'linked1', cells: { 'target-name': 'Linked record' } }],
                },
              ],
            },
            dataUpdatedAt: 1,
          }),
        },
      }),
    useUtils: () => ({
      record: {
        get: { invalidate: state.get },
        kanbanPage: { invalidate: state.page },
        groupCounts: { invalidate: state.counts },
        list: { invalidate: state.list },
      },
    }),
    table: { get: { useQuery: () => ({ data: { baseId: 'b1' } }) } },
    member: {
      me: { useQuery: () => ({ data: state.role ? { role: state.role } : undefined }) },
      list: { useQuery: () => ({ data: [] }) },
    },
    field: { list: { useQuery: () => ({ data: state.fields }) } },
    record: {
      get: {
        useQuery: ({ id }: { id: string }) => ({
          data: { id, cells: { name: state.name, computed: 7, status: 'todo', flag: true } },
        }),
      },
    },
    cell: { upsert: { useMutation: () => ({ mutateAsync: state.write }) } },
  },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: state.error, info: state.info } }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'editor';
  state.name = 'Original';
  state.fields = state.fields.filter(
    (field) => !['multi', 'link', 'attachment', 'user'].includes(field.id),
  );
  state.write.mockResolvedValue({});
});
const detail = (readOnly = false, recordId = 'r1') => (
  <RecordDetail tableId="t1" recordId={recordId} readOnly={readOnly} onClose={() => {}} />
);
it('shows ordered field displays to viewers and refuses editors while membership is unknown', () => {
  state.role = 'viewer';
  const ui = render(detail());
  expect(screen.getByRole('dialog', { name: 'Record details' })).toBeDefined();
  expect(screen.getByText('Original')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Edit Name' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
  state.role = undefined;
  ui.rerender(detail());
  expect(screen.queryByRole('button', { name: 'Edit Name' })).toBeNull();
  state.role = 'editor';
  ui.rerender(detail(true));
  expect(screen.queryByRole('button', { name: 'Edit Name' })).toBeNull();
});
it('reuses text editing, preserves a failed draft and focus, then retries all projections', async () => {
  state.write.mockRejectedValueOnce(new Error('Save failed'));
  render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  expect(screen.queryByRole('button', { name: 'Edit Computed' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Kept draft' },
  });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Save failed'));
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'Kept draft',
  );
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(state.list).toHaveBeenCalledExactlyOnceWith({ tableId: 't1' }));
  expect(state.get).toHaveBeenCalledWith({ tableId: 't1', id: 'r1' });
  expect(state.page).toHaveBeenCalledWith({ tableId: 't1' });
  expect(state.counts).toHaveBeenCalledWith({ tableId: 't1' });
  expect(state.write).toHaveBeenLastCalledWith({
    recordId: 'r1',
    fieldId: 'name',
    value: 'Kept draft',
  });
});
it('reuses select choices and boolean direct editing', async () => {
  render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Status' }));
  const option = await screen.findByRole('option', { name: 'Done' });
  fireEvent.pointerDown(option, { pointerType: 'mouse' });
  fireEvent.click(option);
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith({ recordId: 'r1', fieldId: 'status', value: 'done' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith({ recordId: 'r1', fieldId: 'flag', value: false }),
  );
});
it('refreshes the original table after unmount without stale success or failure feedback', async () => {
  let resolve!: (value: unknown) => void;
  state.write.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const ui = render(detail());
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  ui.rerender(detail(false, 'r2'));
  await act(async () => resolve({ overwroteRecentBy: { userId: 'other' } }));
  expect(state.get).toHaveBeenCalledWith({ tableId: 't1', id: 'r1' });
  expect(state.list).toHaveBeenCalledWith({ tableId: 't1' });
  expect(state.info).not.toHaveBeenCalled();
  expect(screen.queryByText('Saving…')).toBeNull();
  let reject!: (error: Error) => void;
  state.write.mockImplementation(
    () =>
      new Promise((_r, j) => {
        reject = j;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  ui.unmount();
  await act(async () => reject(new Error('Late failure')));
  expect(state.error).not.toHaveBeenCalled();
});

it('retains unsaved typed input through remote refresh and saves explicitly', async () => {
  const ui = render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'My draft' },
  });
  state.name = 'Remote change';
  ui.rerender(detail());
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'My draft',
  );
  fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
  expect(state.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save Name' }));
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith({
      recordId: 'r1',
      fieldId: 'name',
      value: 'My draft',
    }),
  );
});
it('uses field Escape to cancel a draft without writing and reports recent overwrite hints', async () => {
  state.write.mockResolvedValue({ overwroteRecentBy: { userId: 'another-user' } });
  render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Canceled' },
  });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  expect(state.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  await waitFor(() =>
    expect(state.info).toHaveBeenCalledWith('Overwrote a recent edit by another-'),
  );
});

it('serializes rapid multi-select writes and supplies linked record context', async () => {
  state.fields = [
    ...state.fields,
    {
      id: 'multi',
      name: 'Tags',
      type: 'multi-select',
      options: {
        choices: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
      },
    },
    { id: 'link', name: 'Links', type: 'link', options: { targetTableId: 'target1' } },
  ];
  let resolve!: (value: unknown) => void;
  state.write.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Tags' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
  expect(state.write).toHaveBeenCalledTimes(1);
  await act(async () => resolve({}));
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2));
  expect(state.write).toHaveBeenLastCalledWith({
    recordId: 'r1',
    fieldId: 'multi',
    value: ['a', 'b'],
  });
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Alpha' }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Links' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Linked record' }));
  await waitFor(() =>
    expect(state.write).toHaveBeenLastCalledWith({
      recordId: 'r1',
      fieldId: 'link',
      value: ['linked1'],
    }),
  );
});

it('keeps the final intended multi-select draft after a failed queued write until explicit retry', async () => {
  state.fields = [
    ...state.fields,
    {
      id: 'multi',
      name: 'Tags',
      type: 'multi-select',
      options: {
        choices: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
      },
    },
  ];
  let reject!: (error: Error) => void;
  state.write.mockImplementationOnce(
    () =>
      new Promise((_r, j) => {
        reject = j;
      }),
  );
  render(detail());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Tags' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
  await act(async () => reject(new Error('Selection failed')));
  expect(screen.getByRole('alert').textContent).toContain('Selection failed');
  expect((screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'Beta' }) as HTMLInputElement).checked).toBe(true);
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2));
  expect(state.write).toHaveBeenLastCalledWith({
    recordId: 'r1',
    fieldId: 'multi',
    value: ['a', 'b'],
  });
});
