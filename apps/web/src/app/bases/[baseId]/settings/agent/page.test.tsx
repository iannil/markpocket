// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), tokens: [] as Record<string, unknown>[] }));
vi.mock('next/navigation', () => ({ useParams: () => ({ baseId: 'current-base' }) }));
vi.mock('@/lib/breadcrumb-context', () => ({ useBreadcrumbSetter: () => {} }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ token: { list: { invalidate: vi.fn() } } }),
    token: {
      list: { useQuery: () => ({ data: mocks.tokens }) },
      create: { useMutation: () => ({ mutate: mocks.create }) },
      revoke: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    share: { list: { useQuery: () => ({ data: [] }) } },
  },
}));
import Page from './page';
beforeEach(() => {
  mocks.create.mockReset();
  mocks.tokens = [];
});
afterEach(cleanup);
const submit = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Token name' }), {
    target: { value: 'Agent' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'create token' }));
};
it('explicitly submits current base/read/30 days as safe defaults', () => {
  render(<Page />);
  submit();
  expect(mocks.create).toHaveBeenCalledWith({
    name: 'Agent',
    baseId: 'current-base',
    access: 'read',
    expiresInDays: 30,
  });
});
it('allows explicit all-base write and never-expiring credentials', () => {
  render(<Page />);
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'all' } });
  fireEvent.change(screen.getByLabelText('Access'), { target: { value: 'write' } });
  fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: 'never' } });
  submit();
  expect(mocks.create).toHaveBeenCalledWith({
    name: 'Agent',
    baseId: null,
    access: 'write',
    expiresInDays: null,
  });
});
it.each([1, 365])('supports a %s-day lifetime with native bounds', (days) => {
  render(<Page />);
  const input = screen.getByLabelText('Days until expiry');
  expect(input.getAttribute('min')).toBe('1');
  expect(input.getAttribute('max')).toBe('365');
  fireEvent.change(input, { target: { value: String(days) } });
  submit();
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ expiresInDays: days }));
});
it('clearly labels legacy all-base/write/no-expiry tokens and expired credentials', () => {
  mocks.tokens = [
    {
      id: 'legacy',
      name: 'Legacy',
      tokenPrefix: 'mpk_legacy',
      createdAt: '2026-01-01',
      baseId: null,
      access: 'write',
      expiresAt: null,
    },
    {
      id: 'old',
      name: 'Expired reader',
      tokenPrefix: 'mpk_old',
      createdAt: '2026-01-01',
      baseId: 'current-base',
      access: 'read',
      expiresAt: '2026-01-02',
    },
  ];
  render(<Page />);
  expect(screen.getByText('All bases · Read & write · Never expires')).toBeTruthy();
  expect(screen.getByText(/Current base · Read · Expired/)).toBeTruthy();
});
