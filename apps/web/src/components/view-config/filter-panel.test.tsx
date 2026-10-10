// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FilterGroup } from '@/lib/view-ast';
import { FieldType } from '@/lib/field-types';
import { FilterPanel } from './filter-panel';
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
    value: string;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));
afterEach(cleanup);
const fields = [{ id: 'n', name: 'Number', type: FieldType.Number, options: {} }];
it.each([
  {
    op: 'and',
    conditions: [{ op: 'or', conditions: [{ fieldId: 'n', operator: 'equals', operand: 1 }] }],
  },
  { fieldId: 'n', operator: 'equals', operand: 1 },
  { op: 'or', conditions: [{ fieldId: 'n', operator: 'equals', operand: 1 }] },
])('preserves advanced filter %j', (filter) => {
  const onChange = vi.fn();
  render(<FilterPanel fields={fields} filter={filter as FilterGroup} onChange={onChange} />);
  expect(screen.getByRole('status').textContent).toContain('advanced filter');
  expect(screen.queryByText('Add condition')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
it('selects >= as gte', () => {
  const onChange = vi.fn();
  render(
    <FilterPanel
      fields={fields}
      filter={{ op: 'and', conditions: [{ fieldId: 'n', operator: 'equals', operand: 1 }] }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'gte' } });
  expect(onChange).toHaveBeenCalledWith({
    op: 'and',
    conditions: [{ fieldId: 'n', operator: 'gte', operand: 1 }],
  });
});
