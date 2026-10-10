// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { PublicForm } from './public-form';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const config = {
  title: 'Contact',
  description: '',
  successMessage: 'Received',
  fields: [{ id: 'f', name: 'Name', type: 'text', options: {}, required: true }],
};
it('stops replay at seven days from the first attempt and requires a fresh confirmed UUID', async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  const send = vi.fn().mockRejectedValue(Error('network'));
  vi.stubGlobal('fetch', send);
  render(<PublicForm token="mpf_test" config={config} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Retry' });
  now.mockReturnValue(start + 7 * 24 * 60 * 60 * 1000 - 1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][1].body).toBe(send.mock.calls[0][1].body);
  now.mockReturnValue(start + 7 * 24 * 60 * 60 * 1000);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(send).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('alert').textContent).toContain('seven-day retry window has expired');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm new submission' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect(send).toHaveBeenCalledTimes(3);
  expect(JSON.parse(send.mock.calls[2][1].body).requestId).not.toBe(
    JSON.parse(send.mock.calls[0][1].body).requestId,
  );
  // Confirmation starts a new safety window; ordinary retries do not.
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect(send.mock.calls[3][1].body).toBe(send.mock.calls[2][1].body);
});
it('freezes the body and request id after an uncertain response', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', send);
  render(<PublicForm token="mpf_test" config={config} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Retry' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Received');
  expect(send.mock.calls[0][1].body).toBe(send.mock.calls[1][1].body);
});
it('requires explicit confirmation and a new id after editing an uncertain submission', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', send);
  render(<PublicForm token="mpf_test" config={config} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Retry' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } });
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm new submission' }));
  await screen.findByText('Received');
  expect(JSON.parse(send.mock.calls[0][1].body).requestId).not.toBe(
    JSON.parse(send.mock.calls[1][1].body).requestId,
  );
  expect(JSON.parse(send.mock.calls[1][1].body).cells).toEqual({ f: 'Grace' });
});
it('requires a new-submission confirmation for an expired receipt conflict', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', send);
  render(<PublicForm token="mpf_test" config={config} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm new submission' }));
  await screen.findByText('Received');
  expect(JSON.parse(send.mock.calls[0][1].body).requestId).not.toBe(
    JSON.parse(send.mock.calls[1][1].body).requestId,
  );
});
it('normalizes zero and requires a required boolean to be checked', async () => {
  const send = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', send);
  render(
    <PublicForm
      token="mpf_test"
      config={{
        ...config,
        fields: [
          { id: 'n', name: 'Count', type: 'number', options: {}, required: true },
          { id: 'b', name: 'Consent', type: 'boolean', options: {}, required: true },
        ],
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Count'), { target: { value: '0' } });
  expect(screen.getByLabelText('Consent (must be checked)').hasAttribute('required')).toBe(true);
  fireEvent.click(screen.getByLabelText('Consent (must be checked)'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(JSON.parse(send.mock.calls[0][1].body).cells).toEqual({ n: 0, b: true });
});
