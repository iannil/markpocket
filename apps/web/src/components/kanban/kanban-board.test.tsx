// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KanbanBoard } from './kanban-board';

const state = vi.hoisted(() => ({
  options: { kanban: { groupFieldId: 'status', titleFieldId: 'title' } } as Record<string, unknown>,
  fields: [
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
    { id: 'title', name: 'Title', type: 'text', options: {} },
  ],
  counts: { total: 51, groups: [{ key: 'todo' as string | null, count: 51 }] },
  page: vi.fn(),
  write: vi.fn(),
  save: vi.fn(),
  invalidate: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      record: {
        kanbanPage: { invalidate: state.invalidate },
        groupCounts: { invalidate: state.invalidate },
        list: { invalidate: state.invalidate },
      },
      view: { list: { invalidate: state.invalidate } },
    }),
    field: { list: { useQuery: () => ({ data: state.fields }) } },
    view: {
      list: {
        useQuery: () => ({
          data: [
            { id: 'v1', type: 'kanban', options: state.options },
            { id: 'v2', type: 'kanban', options: state.options },
          ],
        }),
      },
      updateOptions: { useMutation: () => ({ mutateAsync: state.save, isPending: false }) },
    },
    member: { list: { useQuery: () => ({ data: [{ userId: 'u1', name: 'Ann' }] }) } },
    record: { groupCounts: { useQuery: () => ({ data: state.counts }) } },
    cell: { upsert: { useMutation: () => ({ mutateAsync: state.write }) } },
    useQueries: (fn: (t: unknown) => unknown[]) => fn({ record: { kanbanPage: state.page } }),
  },
}));
vi.mock('@/components/realtime/realtime-provider', () => ({
  usePresence: () => [{ userId: 'u1', userName: 'Ann' }],
}));
vi.mock('@/lib/toast', () => ({ toast: { error: state.error, info: state.info } }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.options = { kanban: { groupFieldId: 'status', titleFieldId: 'title' } };
  state.counts = { total: 51, groups: [{ key: 'todo', count: 51 }] };
  state.write.mockResolvedValue({});
  state.save.mockResolvedValue({});
  state.page.mockImplementation((input: { choiceId: string | null; offset: number }) => ({
    data: {
      total: input.choiceId === 'todo' ? 51 : 0,
      records:
        input.choiceId === 'todo'
          ? Array.from({ length: input.offset === 0 ? 50 : 1 }, (_, n) => ({
              id: `r${input.offset + n}`,
              cells: { title: `Record ${input.offset + n}`, status: 'todo' },
            }))
          : [],
    },
  }));
});
const board = (readOnly = false, viewId = 'v1') => (
  <KanbanBoard baseId="b1" tableId="t1" viewId={viewId} readOnly={readOnly} />
);

it('paginates only the requested lane with SQL counts and retains empty lanes', () => {
  render(board());
  const todo = screen.getByRole('region', { name: 'Todo' });
  expect(within(todo).getAllByRole('article')).toHaveLength(50);
  expect(within(todo).getByText('51')).toBeDefined();
  expect(
    within(screen.getByRole('region', { name: 'Done' })).queryAllByRole('article'),
  ).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'No status' })).toBeDefined();
  state.page.mockClear();
  fireEvent.click(within(todo).getByRole('button', { name: 'Load more' }));
  expect(
    state.page.mock.calls.filter(([input]) => input.offset === 50).map(([input]) => input),
  ).toEqual([{ tableId: 't1', viewId: 'v1', choiceId: 'todo', offset: 50, limit: 50 }]);
  expect(within(todo).getAllByRole('article')).toHaveLength(51);
  expect(within(todo).queryByRole('button', { name: 'Load more' })).toBeNull();
});
it('retains cards in the original lane on failure, shows Saving and blocks repeat moves', async () => {
  let reject!: (e: Error) => void;
  state.write.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(board());
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.click(within(card).getByRole('button', { name: 'Move record to status' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'Done' }));
  expect(within(card).getByText('Saving…')).toBeDefined();
  expect(
    within(card).getByRole('button', { name: 'Move record to status' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(card.getAttribute('draggable')).toBe('false');
  await act(async () => reject(new Error('Save failed')));
  expect(
    within(screen.getByRole('region', { name: 'Todo' })).getByRole('article', {
      name: 'Record r0',
    }),
  ).toBeDefined();
  expect(screen.getByRole('alert').textContent).toBe('Save failed');
  expect(state.error).toHaveBeenCalledWith('Save failed');
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.invalidate).not.toHaveBeenCalled();
});
it('keeps viewers read-only including configuration', () => {
  render(board(true));
  expect(screen.queryByRole('button', { name: 'Move record to status' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure board' })).toBeNull();
  for (const card of screen.getAllByRole('article'))
    expect(card.getAttribute('draggable')).toBe('false');
});
it('moves through the keyboard menu, invalidates all record projections and reports conflicts', async () => {
  state.write.mockResolvedValue({ overwroteRecentBy: { userId: 'u1' } });
  render(board());
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.click(within(card).getByRole('button', { name: 'Move record to status' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'No status' }));
  await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(3));
  expect(state.write).toHaveBeenCalledWith({ recordId: 'r0', fieldId: 'status', value: null });
  expect(state.info).toHaveBeenCalledWith('Overwrote a recent edit by Ann');
});
it('ignores external drag payloads and permits only visible cards from this board', async () => {
  render(board());
  const done = screen.getByRole('region', { name: 'Done' });
  const dataTransfer = { getData: vi.fn(() => 'r0'), setData: vi.fn() };
  fireEvent.drop(done, { dataTransfer });
  expect(state.write).not.toHaveBeenCalled();
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(done, { dataTransfer });
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith({ recordId: 'r0', fieldId: 'status', value: 'done' }),
  );
});
it('combines unknown and malformed status counts in a non-target Unavailable lane', () => {
  state.counts = {
    total: 56,
    groups: [
      { key: 'todo', count: 51 },
      { key: 'old', count: 2 },
      { key: '__unavailable__', count: 3 },
    ],
  };
  render(board());
  expect(within(screen.getByRole('region', { name: 'Unavailable' })).getByText('5')).toBeDefined();
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.click(within(card).getByRole('button', { name: 'Move record to status' }));
  expect(screen.queryByRole('menuitem', { name: 'Unavailable' })).toBeNull();
});
it('repairs missing config and viewers see an explanation without editable controls', async () => {
  state.options = {};
  const ui = render(board());
  expect(screen.getByText('Configure a status field for this board.')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'status' } });
  fireEvent.change(screen.getByLabelText('Title field'), { target: { value: 'title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save board' }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      id: 'v1',
      options: { kanban: { groupFieldId: 'status', titleFieldId: 'title' } },
    }),
  );
  ui.unmount();
  render(board(true));
  expect(screen.getByText('Ask an editor to configure this board.')).toBeDefined();
  expect(screen.queryByLabelText('Status field')).toBeNull();
  expect(state.page).not.toHaveBeenCalled();
});
it('ignores obsolete UI feedback after switching views but refreshes the committed table', async () => {
  let resolve!: (value: unknown) => void;
  state.write.mockImplementation(
    () =>
      new Promise((success) => {
        resolve = success;
      }),
  );
  const ui = render(board());
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.click(within(card).getByRole('button', { name: 'Move record to status' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'Done' }));
  ui.rerender(board(false, 'v2'));
  expect(screen.queryByText('Saving…')).toBeNull();
  await act(async () => resolve({ overwroteRecentBy: { userId: 'u1' } }));
  expect(state.info).not.toHaveBeenCalled();
  expect(state.invalidate).toHaveBeenCalledTimes(3);
  for (const [scope] of state.invalidate.mock.calls) expect(scope).toEqual({ tableId: 't1' });
});

it('supports arrow navigation and Escape in the keyboard move menu', () => {
  render(board());
  const card = screen.getByRole('article', { name: 'Record r0' });
  const trigger = within(card).getByRole('button', { name: 'Move record to status' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menu = within(card).getByRole('menu');
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Todo' }));
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Done' }));
  fireEvent.keyDown(menu, { key: 'End' });
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'No status' }));
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(within(card).queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('preserves loaded pages and clean settings on harmless metadata refresh', () => {
  const ui = render(board());
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Todo' })).getByRole('button', { name: 'Load more' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Configure board' }));
  state.options = { kanban: { groupFieldId: 'status' } };
  ui.rerender(board());
  expect((screen.getByLabelText('Title field') as HTMLSelectElement).value).toBe('');
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Todo' })).getByRole('button', { name: 'Load more' }),
  );
  state.options = { ...state.options, kanban: { groupFieldId: 'status' } };
  ui.rerender(board());
  expect(within(screen.getByRole('region', { name: 'Todo' })).getAllByRole('article')).toHaveLength(
    51,
  );
});
it('preserves configuration drafts and requires resolving remote settings conflict', () => {
  const ui = render(board());
  fireEvent.click(screen.getByRole('button', { name: 'Configure board' }));
  fireEvent.change(screen.getByLabelText('Title field'), { target: { value: '' } });
  state.options = {
    kanban: { groupFieldId: 'status', titleFieldId: 'title' },
    sort: [{ fieldId: 'title', direction: 'asc' }],
  };
  ui.rerender(board());
  expect((screen.getByLabelText('Title field') as HTMLSelectElement).value).toBe('');
  expect(screen.getByRole('alert').textContent).toContain('changed remotely');
  expect((screen.getByRole('button', { name: 'Save board' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save board' }));
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect((screen.getByLabelText('Title field') as HTMLSelectElement).value).toBe('title');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('retains incomplete configuration drafts when a remote repair makes the board valid', () => {
  state.options = {};
  const ui = render(board());
  fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'status' } });
  state.options = { kanban: { groupFieldId: 'status', titleFieldId: 'title' } };
  ui.rerender(board());
  expect((screen.getByLabelText('Title field') as HTMLSelectElement).value).toBe('');
  expect(screen.getByRole('alert').textContent).toContain('changed remotely');
});
it('never accepts a drag from another mounted board', () => {
  const ui = render(
    <>
      {board(false, 'v1')}
      {board(false, 'v2')}
    </>,
  );
  const boards = within(ui.container).getAllByLabelText('Kanban board');
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(within(boards[0]!).getByRole('article', { name: 'Record r0' }), {
    dataTransfer,
  });
  fireEvent.drop(within(boards[1]!).getByRole('region', { name: 'Done' }), { dataTransfer });
  expect(state.write).not.toHaveBeenCalled();
  expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'r0');
});
it('moves displayed cards only after the server succeeds and refreshes lane data', async () => {
  let confirm!: () => void;
  state.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = () => {
          state.counts = {
            total: 51,
            groups: [
              { key: 'todo', count: 50 },
              { key: 'done', count: 1 },
            ],
          };
          state.page.mockImplementation((input: { choiceId: string | null }) => ({
            data: {
              total: input.choiceId === 'todo' ? 50 : input.choiceId === 'done' ? 1 : 0,
              records:
                input.choiceId === 'done'
                  ? [{ id: 'r0', cells: { title: 'Record 0', status: 'done' } }]
                  : input.choiceId === 'todo'
                    ? Array.from({ length: 50 }, (_, n) => ({
                        id: `r${n + 1}`,
                        cells: { title: `Record ${n + 1}`, status: 'todo' },
                      }))
                    : [],
            },
          }));
          resolve({});
        };
      }),
  );
  render(board());
  const card = screen.getByRole('article', { name: 'Record r0' });
  fireEvent.click(within(card).getByRole('button', { name: 'Move record to status' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'Done' }));
  expect(
    within(screen.getByRole('region', { name: 'Todo' })).getByRole('article', {
      name: 'Record r0',
    }),
  ).toBeDefined();
  await act(async () => confirm());
  expect(
    within(screen.getByRole('region', { name: 'Done' })).getByRole('article', {
      name: 'Record r0',
    }),
  ).toBeDefined();
  expect(
    within(screen.getByRole('region', { name: 'Todo' })).queryByRole('article', {
      name: 'Record r0',
    }),
  ).toBeNull();
});

it('invalidates settings metadata after switching views without obsolete editor feedback', async () => {
  let resolve!: (value: unknown) => void;
  state.save.mockImplementation(
    () =>
      new Promise((success) => {
        resolve = success;
      }),
  );
  state.options = {};
  const ui = render(board());
  fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'status' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save board' }));
  ui.rerender(board(false, 'v2'));
  fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'status' } });
  await act(async () => resolve({}));
  expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ tableId: 't1' });
  expect(screen.getByLabelText('Status field')).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
});
