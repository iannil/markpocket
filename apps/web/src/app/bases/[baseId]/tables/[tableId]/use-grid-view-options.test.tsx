// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilterPanel } from '@/components/view-config/filter-panel';
import { FieldType } from '@/lib/field-types';
import type { ViewOptions } from '@/lib/view-ast';
import { useGridViewOptions } from './use-grid-view-options';

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  view: vi.fn(),
  rows: vi.fn(),
  counts: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    view: { updateOptions: { useMutation: () => ({ mutateAsync: mocks.write }) } },
    useUtils: () => ({
      view: { list: { invalidate: mocks.view } },
      record: { list: { invalidate: mocks.rows }, groupCounts: { invalidate: mocks.counts } },
    }),
  },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error } }));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const initial: ViewOptions = {
  filter: { op: 'and', conditions: [{ fieldId: 'n', operator: 'equals', operand: 1 }] },
};
const fields = [{ id: 'n', name: 'Number', type: FieldType.Number, options: {} }];
function Editor({ options = initial }: { options?: ViewOptions }) {
  const { viewOptions, patchOptions } = useGridViewOptions('t1', 'v1', options);
  return (
    <>
      <FilterPanel
        fields={fields}
        filter={viewOptions.filter}
        onChange={(filter) => patchOptions({ filter })}
      />
      <button onClick={() => patchOptions({ columnWidth: { n: 220 } })}>Resize</button>
      <button onClick={() => patchOptions({ hiddenFields: ['other'] })}>Hide</button>
    </>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of [mocks.write, mocks.view, mocks.rows, mocks.counts])
    mock.mockResolvedValue(undefined);
});
afterEach(cleanup);

it.each([
  ['gte', '≥'],
  ['lte', '≤'],
  ['ne', '≠'],
])('renders stored %s as %s before opening the real Select', (operator, label) => {
  render(
    <Editor
      options={{ filter: { op: 'and', conditions: [{ fieldId: 'n', operator, operand: 1 }] } }}
    />,
  );
  const selected = screen.getAllByRole('combobox')[1]!.querySelector('[data-slot="select-value"]');
  expect(selected!.textContent).toBe(label);
  expect(mocks.write).not.toHaveBeenCalled();
});

it('serializes rapid real-Select filter edits and overlapping UI saves through refetch', async () => {
  const first = deferred();
  const second = deferred();
  const refetch = deferred();
  mocks.write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  mocks.view.mockReturnValueOnce(refetch.promise);
  const ui = render(<Editor />);
  fireEvent.click(screen.getAllByRole('combobox')[1]!);
  const comparison = await screen.findByRole('option', { name: '≥' });
  fireEvent.pointerDown(comparison, { pointerType: 'mouse' });
  fireEvent.click(comparison);
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  // The real selected renderer shows the label, while persistence uses gte.
  expect(
    screen.getAllByRole('combobox')[1]!.querySelector('[data-slot="select-value"]')!.textContent,
  ).toBe('≥');
  expect(mocks.write.mock.calls[0][0].options.filter.conditions[0].operator).toBe('gte');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Resize' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(mocks.write).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve());
  expect(mocks.rows).toHaveBeenCalledWith({ tableId: 't1', viewId: 'v1' });
  expect(mocks.counts).toHaveBeenCalledTimes(1);
  ui.rerender(<Editor options={mocks.write.mock.calls[0][0].options} />);
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('90');
  expect(mocks.write).toHaveBeenCalledTimes(1);
  await act(async () => refetch.resolve());
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  expect(mocks.write.mock.calls[1][0].options.filter.conditions[0]).toEqual({
    fieldId: 'n',
    operator: 'gte',
    operand: '90',
  });
  await act(async () => second.resolve());
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(4));
  expect(mocks.write.mock.calls[3][0].options).toEqual({
    filter: { op: 'and', conditions: [{ fieldId: 'n', operator: 'gte', operand: '90' }] },
    columnWidth: { n: 220 },
    hiddenFields: ['other'],
  });
  // Both filter commits refresh rows and counts; width/visibility commits do not.
  expect(mocks.rows).toHaveBeenCalledTimes(2);
  expect(mocks.counts).toHaveBeenCalledTimes(2);
});

it.each(['switch', 'unmount'])(
  'cancels unsent options on %s while reconciling the sent request',
  async (action) => {
    const first = deferred();
    mocks.write.mockReturnValueOnce(first.promise);
    const hook = renderHook(({ viewId }) => useGridViewOptions('t1', viewId, initial), {
      initialProps: { viewId: 'v1' },
    });
    act(() => hook.result.current.patchOptions({ filter: undefined }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    act(() => hook.result.current.patchOptions({ hiddenFields: ['n'] }));
    if (action === 'switch') {
      hook.rerender({ viewId: 'v2' });
      expect(hook.result.current.viewOptions).toEqual(initial);
    } else hook.unmount();
    await act(async () => first.resolve());
    expect(mocks.rows).toHaveBeenCalledWith({ tableId: 't1', viewId: 'v1' });
    expect(mocks.write).toHaveBeenCalledTimes(1);
  },
);

it('refreshes rows when a later UI save also persists a previously failed filter draft', async () => {
  mocks.write.mockRejectedValueOnce(Error('Save failed'));
  const hook = renderHook(() => useGridViewOptions('t1', 'v1', initial));
  act(() => {
    hook.result.current.patchOptions({ filter: undefined });
    hook.result.current.patchOptions({ columnWidth: { n: 240 } });
  });
  await waitFor(() => expect(mocks.rows).toHaveBeenCalledTimes(1));
  expect(mocks.error).toHaveBeenCalledWith('Save failed');
  expect(mocks.write.mock.calls[1][0].options).toEqual({
    filter: undefined,
    columnWidth: { n: 240 },
  });
  expect(mocks.counts).toHaveBeenCalledTimes(1);
});

it('adopts remote options when the current view has no outstanding writes', () => {
  const hook = renderHook(({ options }) => useGridViewOptions('t1', 'v1', options), {
    initialProps: { options: initial },
  });
  const options = { hiddenFields: ['n'] };
  hook.rerender({ options });
  expect(hook.result.current.viewOptions).toEqual(options);
});
