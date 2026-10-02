// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinkCellEditor, LinkTablesContext, type LinkTableData } from './link-cell';

// No jest-dom matchers in this repo — assert on the DOM properties directly.
const checkbox = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const records = [
  { id: 'r1', label: 'Alpha' },
  { id: 'r2', label: 'Beta' },
  { id: 'r3', label: 'Gamma' },
];
const tables: ReadonlyMap<string, LinkTableData> = new Map([
  ['t1', { records, labelById: new Map(records.map((r) => [r.id, r.label] as const)) }],
]);

function renderEditor(initial: string[]) {
  const onWrite = vi.fn();
  render(
    <LinkTablesContext.Provider value={tables}>
      <LinkCellEditor recordIds={initial} targetTableId="t1" onWrite={onWrite} onClose={() => {}} />
    </LinkTablesContext.Provider>,
  );
  return onWrite;
}

// Vitest runs without globals, so @testing-library/react cannot register its
// auto-cleanup — popovers portal into document.body and would leak across
// tests (duplicate label queries).
afterEach(cleanup);

describe('LinkCellEditor', () => {
  it('rapid consecutive toggles do not lose the earlier selection', async () => {
    const onWrite = renderEditor([]);
    // The parent NEVER re-renders with patched recordIds here — exactly the
    // pre-patch window the race lives in: onMutate only lands the optimistic
    // value in the record.list cache after its cancelQueries resolves.
    fireEvent.click(await screen.findByLabelText('Alpha'));
    expect(onWrite).toHaveBeenCalledWith(['r1']);

    fireEvent.click(screen.getByLabelText('Beta'));
    // Pre-fix: the second toggle computed from the stale recordIds=[] and
    // wrote ['r2'], silently dropping Alpha.
    expect(onWrite).toHaveBeenLastCalledWith(['r1', 'r2']);
    // Checkboxes reflect the local selection state, not the stale prop.
    expect(checkbox('Alpha').checked).toBe(true);
    expect(checkbox('Beta').checked).toBe(true);

    // Un-toggling also builds on the local set.
    fireEvent.click(screen.getByLabelText('Alpha'));
    expect(onWrite).toHaveBeenLastCalledWith(['r2']);
  });

  it('seeds selection from the cell value and toggles off from it', async () => {
    const onWrite = renderEditor(['r2']);
    expect(((await screen.findByLabelText('Beta')) as HTMLInputElement).checked).toBe(true);
    expect(checkbox('Alpha').checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Beta'));
    expect(onWrite).toHaveBeenCalledWith([]);
  });
});
