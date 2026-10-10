// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  role: 'owner',
  removeError: null as { message: string } | null,
  rotateError: null as { message: string } | null,
  state: 'overflow',
  slots: 1,
  tables: vi.fn(),
  list: vi.fn(),
  logs: vi.fn(),
  resume: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    member: { me: { useQuery: () => ({ data: { role: mocks.role } }) } },
    table: {
      list: {
        useQuery: () => {
          mocks.tables();
          return { data: [{ id: 'table', name: 'My table' }] };
        },
      },
    },
    useUtils: () => ({
      webhook: { list: { invalidate: vi.fn() }, deliveries: { invalidate: vi.fn() } },
    }),
    webhook: {
      list: {
        useQuery: () => {
          mocks.list();
          return {
            data: Array.from({ length: mocks.slots }, (_, i) => ({
              id: `endpoint-${i}`,
              url: 'https://example.com/hook',
              events: ['record.changed'],
              state: mocks.state,
              overflowAt: mocks.state === 'overflow' ? '2026-10-10' : null,
            })),
          };
        },
      },
      deliveries: {
        useQuery: () => {
          mocks.logs();
          return {
            data: [
              {
                id: 'delivery',
                type: 'record.changed',
                state: 'dead',
                attempts: 5,
                lastStatus: 500,
                lastError: 'http_status',
                time: '2026-10-10',
              },
            ],
          };
        },
      },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      pause: { useMutation: () => ({ mutate: vi.fn() }) },
      resume: { useMutation: () => ({ mutate: mocks.resume }) },
      remove: { useMutation: () => ({ mutate: mocks.remove, error: mocks.removeError }) },
      retry: { useMutation: () => ({ mutate: mocks.retry }) },
      rotate: {
        useMutation: (options: { onSuccess: (value: { secret: string }) => void }) => ({
          mutate: () => options.onSuccess({ secret: 'once-only-secret' }),
          error: mocks.rotateError,
        }),
      },
    },
  },
}));
import { WebhookSettings, WebhookStateNotice } from './webhook-settings';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'owner';
  mocks.removeError = null;
  mocks.rotateError = null;
  mocks.state = 'overflow';
  mocks.slots = 1;
});
afterEach(cleanup);
it.each(['Remove', 'Rotate secret'])(
  'shows %s errors inside the active confirmation dialog',
  (action) => {
    if (action === 'Remove') mocks.removeError = { message: 'Removal failed. Try again.' };
    else mocks.rotateError = { message: 'Rotation failed. Try again.' };
    render(<WebhookSettings baseId="base" />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('dialog').contains(alert)).toBe(true);
    expect(alert.textContent).toContain('failed. Try again.');
  },
);
it('makes the overflow gap and administrator recovery explicit', () => {
  const { rerender } = render(
    <WebhookStateNotice state="overflow" overflowAt="2026-10-10T00:00:00Z" />,
  );
  expect(
    screen.getByText('Some changes were not queued. Reconcile your records before resuming.'),
  ).toBeTruthy();
  rerender(<WebhookStateNotice state="disabled" overflowAt={null} />);
  expect(screen.getByText(/WEBHOOK_ENCRYPTION_KEY/)).toBeTruthy();
});
it.each(['viewer', 'editor', ''])('mounts no management queries for %s', (role) => {
  mocks.role = role;
  render(<WebhookSettings baseId="base" />);
  expect(mocks.tables).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.logs).not.toHaveBeenCalled();
});
it('requires gap confirmation, retries one event and confirms cascading removal', () => {
  render(<WebhookSettings baseId="base" />);
  const resume = screen.getByRole('button', { name: 'Resume' });
  expect((resume as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reconciled my records and acknowledge the gap.'));
  fireEvent.click(resume);
  expect(mocks.resume).toHaveBeenCalledWith({ id: 'endpoint-0', acknowledgeGap: true });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.retry).toHaveBeenCalledWith({ deliveryId: 'delivery' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(
    screen.getByText(/permanently deletes the endpoint, queued deliveries and delivery logs/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove endpoint' }));
  expect(mocks.remove).toHaveBeenCalledWith({ id: 'endpoint-0' });
});
it('shows rotated secret once and explains in-flight old-key delivery', () => {
  mocks.state = 'disabled';
  const { unmount } = render(<WebhookSettings baseId="base" />);
  fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
  expect(screen.getByText(/Requests already sent may finish with the old secret/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
  expect(screen.getByText('once-only-secret')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByText('once-only-secret')).toBeNull();
  unmount();
  render(<WebhookSettings baseId="base" />);
  expect(screen.queryByText('once-only-secret')).toBeNull();
});
it('counts disabled endpoints toward the five-slot limit', () => {
  mocks.state = 'disabled';
  mocks.slots = 5;
  render(<WebhookSettings baseId="base" />);
  expect(
    (screen.getByRole('button', { name: 'Create endpoint' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/All 5 endpoint slots are used/)).toBeTruthy();
});
