import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
vi.mock('./submission', () => ({
  getPublicForm: vi.fn(),
  submitForm: vi.fn(),
  MAX_FORM_BODY_BYTES: 65536,
}));
vi.mock('./publications', () => ({ resolvePublication: vi.fn() }));
// Reuse the real HTTP error helpers without importing the agent caller/database.
vi.mock('../agent-access/agent-caller', () => ({}));
vi.mock('../agent-access/tokens', () => ({}));
import { getPublicForm, submitForm } from './submission';
import { resolvePublication } from './publications';
import { handlePublicFormGet, handlePublicFormPost } from './http';

const payload = { requestId: '50ae4b4a-c2d8-431a-b952-59c092ec48fe', cells: {} };
function request(body = JSON.stringify(payload), headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/forms/token', {
    method: 'POST',
    body,
    headers: { host: 'localhost', ...headers },
  });
}
function headers(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}
let time = Date.now();
beforeEach(() => {
  vi.useFakeTimers();
  time += 120001;
  vi.setSystemTime(time);
  vi.clearAllMocks();
  vi.mocked(resolvePublication).mockResolvedValue({ publicationId: 'publication' } as Awaited<
    ReturnType<typeof resolvePublication>
  >);
  vi.mocked(submitForm).mockResolvedValue({ ok: true });
  vi.mocked(getPublicForm).mockResolvedValue({
    title: 'Form',
    description: '',
    successMessage: 'Thanks',
    fields: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('public form HTTP', () => {
  it.each([{}, { 'content-length': '3' }])(
    'counts all streamed bytes with headers %j',
    async (extra) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32768));
          controller.enqueue(new Uint8Array(32769));
          controller.close();
        },
      });
      const req = new Request('http://localhost/api/forms/token', {
        method: 'POST',
        body: stream,
        headers: extra,
        duplex: 'half',
      } as RequestInit);
      const response = await handlePublicFormPost(req, 'token');
      expect(response.status).toBe(413);
      headers(response);
      expect(resolvePublication).not.toHaveBeenCalled();
      expect(submitForm).not.toHaveBeenCalled();
    },
  );
  it('accepts exactly 64 KiB and same-origin or absent Origin', async () => {
    const body = JSON.stringify(payload).padEnd(65536, ' ');
    for (const extra of [{}, { origin: 'http://localhost' }] as Record<string, string>[]) {
      const response = await handlePublicFormPost(request(body, extra), 'token');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      headers(response);
    }
    expect(submitForm).toHaveBeenCalledWith('token', payload);
  });
  it('rejects cross-origin browser submissions', async () => {
    const response = await handlePublicFormPost(
      request(undefined, { origin: 'https://other.test' }),
      'token',
    );
    expect(response.status).toBe(403);
    headers(response);
    expect(resolvePublication).not.toHaveBeenCalled();
  });
  it('limits a publication to 30 attempts per minute and resets the window', async () => {
    for (let i = 0; i < 30; i++)
      expect((await handlePublicFormPost(request(), 'token')).status).toBe(200);
    const response = await handlePublicFormPost(request(), 'another-token-same-publication');
    expect(response.status).toBe(429);
    headers(response);
    expect(submitForm).toHaveBeenCalledTimes(30);
    vi.advanceTimersByTime(60000);
    expect((await handlePublicFormPost(request(), 'token')).status).toBe(200);
  });
  it('invalid tokens consume the global 120/min POST budget independent of forwarded IP', async () => {
    vi.mocked(resolvePublication).mockResolvedValue(null);
    for (let i = 0; i < 120; i++) {
      const response = await handlePublicFormPost(
        request(undefined, { 'x-forwarded-for': `ip-${i}` }),
        `invalid-${i}`,
      );
      expect(response.status).toBe(404);
      headers(response);
    }
    expect((await handlePublicFormPost(request(), 'valid')).status).toBe(429);
    expect(resolvePublication).toHaveBeenCalledTimes(120);
  });
  it('GET has a separate global 300/min budget, including invalid tokens', async () => {
    vi.mocked(getPublicForm).mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Form is unavailable' }),
    );
    for (let i = 0; i < 300; i++)
      expect((await handlePublicFormGet(new Request('http://localhost'), 'bad')).status).toBe(404);
    const response = await handlePublicFormGet(new Request('http://localhost'), 'good');
    expect(response.status).toBe(429);
    headers(response);
    expect((await handlePublicFormPost(request(), 'token')).status).toBe(200);
  });
  it('returns projected GET data and private headers', async () => {
    const response = await handlePublicFormGet(new Request('http://localhost'), 'token');
    expect(await response.json()).toEqual({
      title: 'Form',
      description: '',
      successMessage: 'Thanks',
      fields: [],
    });
    headers(response);
  });
  it.each(['{', 'null', '[]', '1'])('rejects malformed/non-object JSON %s', async (body) => {
    const response = await handlePublicFormPost(request(body), 'token');
    expect(response.status).toBe(400);
    headers(response);
    expect(submitForm).not.toHaveBeenCalled();
  });
  it.each(['BAD_REQUEST', 'NOT_FOUND', 'CONFLICT', 'PAYLOAD_TOO_LARGE'] as const)(
    'maps %s service errors',
    async (code) => {
      vi.mocked(submitForm).mockRejectedValue(new TRPCError({ code, message: 'Safe message' }));
      const response = await handlePublicFormPost(request(), 'token');
      expect(response.status).toBe(
        { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409, PAYLOAD_TOO_LARGE: 413 }[code],
      );
      headers(response);
    },
  );
  it('masks unexpected errors and emits no token or cells to logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(submitForm).mockRejectedValue(new Error('secret-token-and-cells'));
    const response = await handlePublicFormPost(request(), 'token');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret');
    headers(response);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
