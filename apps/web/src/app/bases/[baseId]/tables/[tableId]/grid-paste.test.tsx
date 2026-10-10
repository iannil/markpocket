// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GridEditor } from './grid-editor';
const state = vi.hoisted(() => ({
  role: 'editor',
  fieldType: 'text',
  rows: [
    { id: 'r1', cells: {} },
    { id: 'r2', cells: {} },
  ],
  total: 2,
  countError: false,
  fetching: false,
  pageError: false,
  views: [
    { id: 'v1', name: 'Grid', type: 'grid', options: {} },
    { id: 'v2', name: 'Other', type: 'grid', options: {} },
  ],
  write: vi.fn(),
  invalidate: vi.fn(),
  showMore: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const query = (data: unknown) => ({ data, isLoading: false, isError: false });
  return {
    trpc: {
      useUtils: () => ({
        record: {
          list: { invalidate: state.invalidate },
          groupCounts: { invalidate: vi.fn().mockResolvedValue(undefined) },
        },
        history: { list: { invalidate: vi.fn() } },
        field: { list: { invalidate: vi.fn() } },
        view: { list: { invalidate: vi.fn() } },
      }),
      field: {
        list: {
          useQuery: () =>
            query([
              { id: 'f1', name: 'Name', type: state.fieldType, options: {} },
              { id: 'f2', name: 'Count', type: 'number', options: {} },
            ]),
        },
      },
      view: {
        list: { useQuery: () => query(state.views) },
        updateOptions: { useMutation: mutation },
      },
      auth: { listUsers: { useQuery: () => query([]) } },
      member: { me: { useQuery: () => query({ role: state.role }) } },
      table: { list: { useQuery: () => query([]) } },
      record: {
        groupCounts: {
          useQuery: () => ({
            ...query({ total: state.total, groups: [{ key: null, count: state.total }] }),
            isError: state.countError,
          }),
        },
        writeBatch: { useMutation: () => ({ mutateAsync: state.write }) },
        create: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
      cell: { upsert: { useMutation: mutation } },
    },
  };
});
vi.mock('./use-paged-records', () => ({
  PAGE_SIZE: 200,
  usePagedRecords: () => ({
    groups: [{ key: null, records: state.rows }],
    total: state.total,
    recordsLoading: false,
    recordsError: null,
    trailingPageError: state.pageError ? { message: 'Network failed', retry: vi.fn() } : null,
    retryRecords: vi.fn(),
    anyFetching: state.fetching,
    showMore: state.showMore,
  }),
}));
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({ count }: { count: number }) => ({
    scrollToIndex: vi.fn(),
    getTotalSize: () => count * 32,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 32 })),
  }),
}));
vi.mock('@/components/realtime/realtime-provider', () => ({ usePresence: () => [] }));
vi.mock('@/lib/breadcrumb-context', () => ({ useBreadcrumbSetter: () => {} }));
vi.mock('@/lib/toast', () => ({ toast: { error: state.toast, info: vi.fn() } }));
vi.mock('./cell-history-dock', () => ({ CellHistoryDock: () => null }));
vi.mock('./link-cell', () => ({
  LinkTablesProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/field-config/field-editor-dialog', () => ({ FieldEditorDialog: () => null }));
vi.mock('@/components/view-config/filter-panel', () => ({ FilterPanel: () => null }));
vi.mock('@/components/view-config/sort-menu', () => ({ SortMenu: () => null }));
vi.mock('@/components/view-config/view-fields-menu', () => ({ ViewFieldsMenu: () => null }));
vi.mock('@/components/view-config/view-tabs', () => ({
  ViewTabs: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <>
      <button onClick={() => onSelect('v2')}>Other view</button>
      <button onClick={() => onSelect('v1')}>Original view</button>
    </>
  ),
}));
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
}
function select() {
  fireEvent.click(screen.getAllByRole('gridcell')[1]!);
}
function paste(text = 'Alice\t12\nBob\t13') {
  fireEvent.paste(screen.getByRole('grid'), { clipboardData: { getData: () => text } });
}
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (v: string) => v });
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.role = 'editor';
  state.fieldType = 'text';
  state.views[0]!.options = {};
  state.rows = [
    { id: 'r1', cells: {} },
    { id: 'r2', cells: {} },
  ];
  state.total = 2;
  state.fetching = false;
  state.pageError = false;
  state.write.mockReset().mockResolvedValue({ created: 0, updated: 2 });
  state.showMore.mockReset();
  state.toast.mockReset();
  state.invalidate.mockReset().mockResolvedValue(undefined);
});
it('confirms a typed rectangle before sending one atomic batch', async () => {
  mount();
  select();
  paste();
  expect(state.write).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(1));
  expect(state.write.mock.calls[0]![0].rows).toEqual([
    { recordId: 'r1', cells: { f1: 'Alice', f2: 12 } },
    { recordId: 'r2', cells: { f1: 'Bob', f2: 13 } },
  ]);
});
it('waits for existing rows and cancels preparation on view switch', async () => {
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 2;
  const ui = mount();
  select();
  paste();
  expect(state.showMore).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  state.rows = [
    { id: 'r1', cells: {} },
    { id: 'r2', cells: {} },
  ];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Paste' });
  fireEvent.click(screen.getByRole('button', { name: 'Other view', hidden: true }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull());
  expect(state.write).not.toHaveBeenCalled();
});
it('leaves editor native paste and viewer paste inert', () => {
  state.role = 'viewer';
  mount();
  select();
  paste();
  expect(state.write).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
});
it('rejects the whole rectangle for an invalid value', () => {
  mount();
  select();
  paste('Alice\tnot-a-number');
  expect(state.toast).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  expect(state.write).not.toHaveBeenCalled();
});
it('reuses frozen IDs and requestId on explicit retry', async () => {
  state.write.mockRejectedValueOnce(new Error('Network timeout'));
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry paste' }));
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2));
  expect(state.write.mock.calls[1]![0]).toEqual(state.write.mock.calls[0]![0]);
});

it('refuses replay after the seven day receipt retention', async () => {
  const time = vi.spyOn(Date, 'now').mockReturnValue(1000);
  state.write.mockRejectedValueOnce(new Error('Network timeout'));
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  const retry = await screen.findByRole('button', { name: 'Retry paste' });
  time.mockReturnValue(1000 + 7 * 24 * 60 * 60 * 1000);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('cannot be safely retried')),
  );
  expect(state.write).toHaveBeenCalledTimes(1);
  time.mockRestore();
});
it('keeps text paste native while editing', () => {
  mount();
  fireEvent.doubleClick(screen.getAllByRole('gridcell')[1]!);
  const input = screen.getByRole('textbox');
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a\tb\nc' } });
  fireEvent(input, event);
  expect(event.defaultPrevented).toBe(false);
  expect(state.write).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
});
it('waits at the page boundary then selects the loaded target', async () => {
  state.rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i + 1}`, cells: {} }));
  state.total = 201;
  const ui = mount();
  fireEvent.click(screen.getAllByRole('gridcell')[199 * 3 + 1]!);
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
  expect(state.showMore).toHaveBeenCalled();
  expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r200');
  state.rows = [...state.rows, { id: 'r201', cells: {} }];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r201'),
  );
});

it('clears rejected server batches and permits a corrected paste', async () => {
  state.write.mockRejectedValueOnce(
    Object.assign(new Error('Invalid value'), { data: { code: 'BAD_REQUEST' } }),
  );
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry paste' })).toBeNull());
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith('Invalid value'));
  paste('Carol\t14');
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2));
  expect(state.write.mock.calls[1]![0].requestId).not.toBe(state.write.mock.calls[0]![0].requestId);
});
it('rejects nonwritable columns before any network call', () => {
  state.fieldType = 'expression';
  mount();
  select();
  paste('x');
  expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('cannot be pasted into'));
  expect(state.write).not.toHaveBeenCalled();
});
it('appends only after reaching the actual end in default order', async () => {
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 1;
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(state.write).toHaveBeenCalled());
  expect(state.write.mock.calls[0]![0].rows[1]).toEqual({
    recordId: undefined,
    cells: { f1: 'Bob', f2: 13 },
  });
});
it('rejects append in sorted views', () => {
  state.views[0]!.options = { sort: [{ fieldId: 'f1', direction: 'asc' }] };
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 1;
  mount();
  select();
  paste();
  expect(state.toast).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
});
it.each(['Tab', 'PageDown'])(
  '%s loads past the current page without selecting an unloaded row',
  async (key) => {
    state.rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i + 1}`, cells: {} }));
    state.total = 201;
    const ui = mount();
    fireEvent.click(screen.getAllByRole('gridcell')[199 * 3 + (key === 'Tab' ? 2 : 1)]!);
    fireEvent.keyDown(screen.getByRole('grid'), { key });
    expect(state.showMore).toHaveBeenCalled();
    expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r200');
    state.rows = [...state.rows, { id: 'r201', cells: {} }];
    ui.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GridEditor baseId="b1" tableId="t1" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r201'),
    );
  },
);
it('Ctrl+End selects only the last loaded row', () => {
  state.total = 201;
  mount();
  select();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'End', ctrlKey: true });
  expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r2');
  expect(state.showMore).not.toHaveBeenCalled();
});

it('freezes the ID rectangle after confirmation is prepared', async () => {
  const ui = mount();
  select();
  paste();
  await screen.findByRole('button', { name: 'Paste' });
  state.rows = [
    { id: 'replacement1', cells: {} },
    { id: 'replacement2', cells: {} },
  ];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(state.write).toHaveBeenCalled());
  expect(state.write.mock.calls[0]![0].rows.map((r: { recordId: string }) => r.recordId)).toEqual([
    'r1',
    'r2',
  ]);
});
it('disables duplicate confirmation while a batch is pending', async () => {
  let finish!: () => void;
  state.write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  const busy = await screen.findByRole('button', { name: 'Working…' });
  fireEvent.click(busy);
  expect(state.write).toHaveBeenCalledTimes(1);
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Working…' })).toBeNull());
});
it('does not prepare against rows still fetching', async () => {
  state.fetching = true;
  const ui = mount();
  select();
  paste();
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  state.fetching = false;
  state.pageError = false;
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Paste' });
  expect(state.write).not.toHaveBeenCalled();
});

it('keeps navigation pending on failure and resolves after retry data arrives', async () => {
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 2;
  state.pageError = true;
  const ui = mount();
  select();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
  expect(state.showMore).not.toHaveBeenCalled();
  expect(screen.getByText(/Failed to load more records/)).toBeTruthy();
  state.pageError = false;
  state.rows = [...state.rows, { id: 'r2', cells: {} }];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toContain('r2'),
  );
});
it('discards a waiting navigation target when switching views', async () => {
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 2;
  const ui = mount();
  select();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Other view' }));
  state.rows = [
    { id: 'r1', cells: {} },
    { id: 'r2', cells: {} },
  ];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).not.toContain('r2');
});
it('cancels a waiting paste when switching views', async () => {
  state.rows = [{ id: 'r1', cells: {} }];
  state.total = 2;
  const ui = mount();
  select();
  paste();
  fireEvent.click(screen.getByRole('button', { name: 'Other view' }));
  state.rows = [
    { id: 'r1', cells: {} },
    { id: 'r2', cells: {} },
  ];
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b1" tableId="t1" />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  expect(state.write).not.toHaveBeenCalled();
});

it('does not resurrect a canceled paste after A to B to A and delayed rejection', async () => {
  let reject!: (error: Error) => void;
  state.write.mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  mount();
  select();
  paste();
  fireEvent.click(await screen.findByRole('button', { name: 'Paste' }));
  await screen.findByRole('button', { name: 'Working…' });
  fireEvent.click(screen.getByRole('button', { name: 'Other view', hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Original view' }));
  await act(async () => {
    reject(new Error('Delayed timeout'));
  });
  expect(screen.queryByRole('button', { name: 'Retry paste' })).toBeNull();
  expect(state.toast).not.toHaveBeenCalledWith('Delayed timeout');
  expect(state.write).toHaveBeenCalledTimes(1);
  paste('Carol\t14');
  await screen.findByRole('button', { name: 'Paste' });
});

it('shows complete toolbar count and explicit count error', () => {
  state.total = 201;
  const ui = mount();
  expect(screen.getByText('2 / 201 records')).toBeDefined();
  state.countError = true;
  ui.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridEditor baseId="b" tableId="t" />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Count unavailable')).toBeDefined();
  state.countError = false;
});
