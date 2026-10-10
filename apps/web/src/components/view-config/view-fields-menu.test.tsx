// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewFieldsMenu } from './view-fields-menu';
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ field: { list: { invalidate: mocks.invalidate } } }),
    field: { reorder: { useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false }) } },
  },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const fields = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'Hidden' },
  { id: 'c', name: 'C' },
];
describe('field ordering controls', () => {
  it('swaps adjacent fields including hidden fields and blocks repeat submissions', async () => {
    let resolve!: () => void;
    mocks.mutate.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(
      <ViewFieldsMenu tableId="table" fields={fields} hiddenFields={['b']} onChange={vi.fn()} />,
    );
    expect((screen.getAllByLabelText('Move field up')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByLabelText('Move field down')[2] as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getAllByLabelText('Move field down')[0]!);
    fireEvent.click(screen.getAllByLabelText('Move field down')[0]!);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({ tableId: 'table', fieldIds: ['b', 'a', 'c'] });
    resolve();
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledWith({ tableId: 'table' }));
  });
  it('disables order and visibility controls for viewers', () => {
    render(
      <ViewFieldsMenu
        tableId="table"
        readOnly
        fields={fields}
        hiddenFields={[]}
        onChange={vi.fn()}
      />,
    );
    for (const button of [
      ...screen.getAllByLabelText('Move field up'),
      ...screen.getAllByLabelText('Move field down'),
    ]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
