// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { PublicForm } from './public-form';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const config = {
  title: 'Contact',
  description: '',
  successMessage: 'Received',
  fields: [{ id: 'f', name: 'Name', type: 'text', options: {}, required: true }],
};
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
