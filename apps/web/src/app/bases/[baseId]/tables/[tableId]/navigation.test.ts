import { expect, it } from 'vitest';
import { nextRowRequest } from './navigation';
it('loads only an unloaded intended row and clamps to the actual end', () => {
  expect(nextRowRequest({ targetRow: 200, loaded: 200, total: 201, fetching: false })).toEqual({
    kind: 'load',
    targetRow: 200,
  });
  expect(nextRowRequest({ targetRow: 200, loaded: 200, total: 201, fetching: true })).toEqual({
    kind: 'wait',
  });
  expect(nextRowRequest({ targetRow: 201, loaded: 201, total: 201, fetching: false })).toEqual({
    kind: 'select',
    row: 200,
  });
  expect(nextRowRequest({ targetRow: 0, loaded: 0, total: 0, fetching: false })).toEqual({
    kind: 'wait',
  });
  expect(nextRowRequest({ targetRow: -1, loaded: 1, total: 2, fetching: true })).toEqual({
    kind: 'select',
    row: 0,
  });
});
