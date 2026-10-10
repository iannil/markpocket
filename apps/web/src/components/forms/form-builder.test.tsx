// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FormBuilder } from './form-builder';
const state = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  save: vi.fn(),
  publish: vi.fn(),
  list: vi.fn(),
  publications: [] as unknown[],
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      view: { list: { invalidate: vi.fn() } },
      form: { list: { invalidate: vi.fn() } },
    }),
    field: {
      list: {
        useQuery: () => ({
          data: [
            { id: 'f', name: 'Name', type: 'text', options: {} },
            { id: 'secret', name: 'Private attachment', type: 'attachment', options: {} },
          ],
        }),
      },
    },
    view: {
      list: { useQuery: () => ({ data: [{ id: 'v', options: state.options }] }) },
      updateOptions: { useMutation: () => ({ mutate: state.save }) },
    },
    form: {
      list: {
        useQuery: (...args: unknown[]) => {
          state.list(...args);
          return { data: state.publications };
        },
      },
      publish: { useMutation: () => ({ mutate: state.publish }) },
      revoke: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
afterEach(cleanup);
beforeEach(() => {
  state.options = {
    form: {
      title: 'Contact',
      description: '',
      successMessage: 'Received',
      fields: [{ fieldId: 'f', required: false }],
    },
  };
  state.save.mockClear();
  state.publish.mockClear();
  state.list.mockClear();
  state.publications = [];
});
it('viewer sees a disabled preview without editing or publication controls', () => {
  render(<FormBuilder viewId="v" tableId="t" readOnly />);
  expect(screen.getByText('Form preview')).toBeDefined();
  expect((screen.getByLabelText('Name') as HTMLInputElement).closest('fieldset')?.disabled).toBe(
    true,
  );
  expect(screen.queryByRole('button', { name: 'Save form' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(state.list).toHaveBeenCalledWith({ viewId: 'v' }, { enabled: false });
});
it('editor saves selected public fields and cannot publish', () => {
  render(<FormBuilder viewId="v" tableId="t" readOnly={false} />);
  expect(screen.queryByText('Private attachment')).toBeNull();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
  expect(state.save).toHaveBeenCalledWith({
    id: 'v',
    options: {
      form: expect.objectContaining({
        title: 'New title',
        fields: [{ fieldId: 'f', required: false }],
      }),
    },
  });
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
});
it('owner publishes with default 30-day expiry and must save changes first', () => {
  render(<FormBuilder viewId="v" tableId="t" readOnly={false} isOwner />);
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  expect(state.publish).toHaveBeenCalledWith({ viewId: 'v', expiresInDays: 30 });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
  expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
