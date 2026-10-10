// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ViewTabs } from './view-tabs';
const mocks = vi.hoisted(() => ({ create: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ view: { list: { invalidate: mocks.invalidate } } }),
    view: {
      create: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      rename: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('@/components/confirm-dialog', () => ({ ConfirmDialog: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('offers delivered Kanban alongside Grid and Form and creates the selected type', () => {
  render(<ViewTabs tableId="t1" views={[]} activeViewId={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '+ view' }));
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Grid',
    'Form',
    'Kanban',
  ]);
  fireEvent.change(screen.getByLabelText('View type'), { target: { value: 'kanban' } });
  fireEvent.change(screen.getByLabelText('New view name'), { target: { value: 'Project Board' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create view' }));
  expect(mocks.create).toHaveBeenCalledWith(
    { tableId: 't1', type: 'kanban', name: 'Project Board' },
    expect.any(Object),
  );
});
it('does not offer view creation to viewers', () => {
  render(<ViewTabs tableId="t1" views={[]} activeViewId={null} onSelect={vi.fn()} readOnly />);
  expect(screen.queryByRole('button', { name: '+ view' })).toBeNull();
});
