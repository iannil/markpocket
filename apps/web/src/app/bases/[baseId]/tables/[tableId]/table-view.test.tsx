// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TableView } from './table-view';

const state = vi.hoisted(() => ({
  views: [{ id: 'v1', name: 'Grid', type: 'grid', options: {} }],
  fields: [{ id: 'f1', name: 'Name', type: 'text', options: {} }],
  role: 'editor',
  loading: false,
  error: false,
  grid: vi.fn(),
  kanban: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      field: { list: { invalidate: state.invalidate } },
      view: { list: { invalidate: state.invalidate } },
    }),
    field: {
      list: {
        useQuery: () => ({ data: state.fields, isLoading: state.loading, isError: state.error }),
      },
    },
    view: {
      list: { useQuery: () => ({ data: state.views, isLoading: state.loading, isError: false }) },
    },
    member: { me: { useQuery: () => ({ data: { role: state.role } }) } },
  },
}));
vi.mock('@/components/forms/form-builder', () => ({ FormBuilder: () => <div>Form renderer</div> }));
vi.mock('@/components/kanban/kanban-board', () => ({
  KanbanBoard: (props: unknown) => {
    state.kanban(props);
    return <div>Kanban renderer</div>;
  },
}));
vi.mock('./grid-editor', () => ({
  GridEditor: (props: unknown) => {
    state.grid(props);
    return <div>Grid renderer</div>;
  },
}));
vi.mock('@/components/view-config/view-tabs', () => ({
  ViewTabs: ({
    views,
    activeViewId,
    onSelect,
    readOnly,
  }: {
    views: typeof state.views;
    activeViewId: string;
    onSelect: (id: string) => void;
    readOnly: boolean;
  }) => (
    <div aria-label={readOnly ? 'Read only tabs' : 'Editable tabs'}>
      <span>{activeViewId}</span>
      {views.map((view) => (
        <button key={view.id} onClick={() => onSelect(view.id)}>
          {view.name}
        </button>
      ))}
    </div>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  state.views = [{ id: 'v1', name: 'Grid', type: 'grid', options: {} }];
  state.role = 'editor';
  state.loading = false;
  state.error = false;
  state.grid.mockClear();
  state.kanban.mockClear();
  state.invalidate.mockClear();
});
it('passes the resolved view and field projection before mounting Grid', () => {
  render(<TableView baseId="b1" tableId="t1" />);
  expect(state.grid).toHaveBeenLastCalledWith(
    expect.objectContaining({ viewId: 'v1', fields: state.fields, readOnly: false }),
  );
});
it('owns view selection and falls back when the selected view disappears', () => {
  state.views.push({ id: 'v2', name: 'Other', type: 'grid', options: {} });
  const ui = render(<TableView baseId="b1" tableId="t1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  expect(state.grid).toHaveBeenLastCalledWith(expect.objectContaining({ viewId: 'v2' }));
  state.views = state.views.slice(0, 1);
  ui.rerender(<TableView baseId="b1" tableId="t1" />);
  expect(state.grid).toHaveBeenLastCalledWith(expect.objectContaining({ viewId: 'v1' }));
});
it('never mounts Grid for Form drafts or unsupported view types', () => {
  state.views = [{ id: 'form1', name: 'Contact', type: 'form', options: {} }];
  const ui = render(<TableView baseId="b1" tableId="t1" />);
  expect(screen.getByText('Form renderer')).toBeDefined();
  expect(state.grid).not.toHaveBeenCalled();
  state.views[0]!.type = 'calendar';
  ui.rerender(<TableView baseId="b1" tableId="t1" />);
  expect(screen.getByText('This view type is not available yet.')).toBeDefined();
  expect(state.grid).not.toHaveBeenCalled();
});
it('renders read-only while membership is unresolved', () => {
  state.role = '';
  render(<TableView baseId="b1" tableId="t1" />);
  expect(state.grid).toHaveBeenLastCalledWith(expect.objectContaining({ readOnly: true }));
  expect(screen.getByLabelText('Read only tabs')).toBeDefined();
});
it('does not mount Grid until metadata loads and supports retry', () => {
  state.loading = true;
  const ui = render(<TableView baseId="b1" tableId="t1" />);
  expect(state.grid).not.toHaveBeenCalled();
  state.loading = false;
  state.error = true;
  ui.rerender(<TableView baseId="b1" tableId="t1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.invalidate).toHaveBeenCalledTimes(2);
  expect(state.grid).not.toHaveBeenCalled();
});

it('mounts Kanban only for the controlled view and unmounts it for Grid or Form', () => {
  state.views = [
    { id: 'k1', name: 'Board', type: 'kanban', options: {} },
    { id: 'v1', name: 'Grid', type: 'grid', options: {} },
    { id: 'f1', name: 'Form', type: 'form', options: {} },
  ];
  render(<TableView baseId="b1" tableId="t1" />);
  expect(state.kanban).toHaveBeenLastCalledWith(
    expect.objectContaining({ baseId: 'b1', tableId: 't1', viewId: 'k1', readOnly: false }),
  );
  expect(state.grid).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
  expect(screen.queryByText('Kanban renderer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.queryByText('Kanban renderer')).toBeNull();
});
