import { describe, expect, it } from 'vitest';

import { displayToExpression, expressionToDisplay } from './expression-display';

const fields = [
  { id: '5cd718dd-2407-4182-a233-a1e811de1348', name: 'Age' },
  { id: '1b1f083b-5de2-40c0-899b-354764a035ed', name: 'Price' },
  { id: 'c12ccc46-364b-47df-ba23-cc91b1229adc', name: 'Qty' },
];

describe('expressionToDisplay', () => {
  it('renders stored UUID tokens as field names', () => {
    expect(expressionToDisplay('{5cd718dd-2407-4182-a233-a1e811de1348} * 2', fields)).toBe(
      '{Age} * 2',
    );
  });

  it('handles multiple tokens and mixed operators', () => {
    expect(
      expressionToDisplay(
        '{1b1f083b-5de2-40c0-899b-354764a035ed} + {c12ccc46-364b-47df-ba23-cc91b1229adc}',
        fields,
      ),
    ).toBe('{Price} + {Qty}');
  });

  it('leaves unknown tokens untouched', () => {
    expect(expressionToDisplay('{not-a-field} + 1', fields)).toBe('{not-a-field} + 1');
  });

  it('does not substitute field names containing braces', () => {
    expect(expressionToDisplay('{weird-id}', [{ id: 'weird-id', name: 'a{b' }])).toBe('{weird-id}');
  });
});

describe('displayToExpression', () => {
  it('maps names back to ids', () => {
    expect(displayToExpression('{Age} * 2', fields)).toBe(
      '{5cd718dd-2407-4182-a233-a1e811de1348} * 2',
    );
  });

  it('round-trips through the display form', () => {
    const stored =
      '{5cd718dd-2407-4182-a233-a1e811de1348} * {c12ccc46-364b-47df-ba23-cc91b1229adc}';
    const round = displayToExpression(expressionToDisplay(stored, fields), fields);
    expect(round).toBe(stored);
  });

  it('passes raw uuid tokens through unchanged', () => {
    expect(displayToExpression('{5cd718dd-2407-4182-a233-a1e811de1348} + 1', fields)).toBe(
      '{5cd718dd-2407-4182-a233-a1e811de1348} + 1',
    );
  });

  it('passes unknown names through unchanged', () => {
    expect(displayToExpression('{Nope} + 1', fields)).toBe('{Nope} + 1');
  });

  it('first field wins on duplicate names', () => {
    expect(
      displayToExpression('{Same}', [
        { id: 'first', name: 'Same' },
        { id: 'second', name: 'Same' },
      ]),
    ).toBe('{first}');
  });
});
