import { afterEach, describe, expect, it } from 'vitest';

import {
  attachmentDisposition,
  contentLengthExceeds,
  createUserConcurrencyLimiter,
  MAX_TRPC_BODY_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  readBodyWithCap,
  readEnvNonNegativeInt,
  safeCallbackUrl,
  truncateFilenameBytes,
} from './http-guards';

function withContentLength(value?: string): { headers: Headers } {
  const headers = new Headers();
  if (value !== undefined) headers.set('content-length', value);
  return { headers };
}

describe('contentLengthExceeds', () => {
  it('rejects a body over the limit', () => {
    expect(contentLengthExceeds(withContentLength('9000000'), 8 * 1024 * 1024)).toBe(true);
  });

  it('allows a body at or under the limit', () => {
    expect(contentLengthExceeds(withContentLength(String(8 * 1024 * 1024)), 8 * 1024 * 1024)).toBe(
      false,
    );
    expect(contentLengthExceeds(withContentLength('1024'), 8 * 1024 * 1024)).toBe(false);
  });

  it('passes through when Content-Length is absent (chunked encoding)', () => {
    // Header-level gate is blind here by design — chunked bodies are capped
    // by readBodyWithCap at the route layer instead.
    expect(contentLengthExceeds(withContentLength(), 8 * 1024 * 1024)).toBe(false);
  });

  it('passes through on a malformed header', () => {
    expect(contentLengthExceeds(withContentLength('abc'), 8 * 1024 * 1024)).toBe(false);
    expect(contentLengthExceeds(withContentLength('-5'), 8 * 1024 * 1024)).toBe(false);
  });
});

describe('body limit constants', () => {
  it('tRPC cap is 12MB = 2× the 5MB csvText byte cap + envelope headroom', () => {
    // plugin-csv caps csvText at 5MB of UTF-8 bytes; JSON escaping can
    // double the payload (quote/backslash/newline → two bytes each), so the
    // transport gate sits at 2×5MB plus envelope room.
    expect(MAX_TRPC_BODY_BYTES).toBe(12 * 1024 * 1024);
    expect(MAX_TRPC_BODY_BYTES).toBeGreaterThan(2 * 5 * 1024 * 1024);
  });

  it('upload cap is 55MB — multipart envelope around the 50MB file limit', () => {
    expect(MAX_UPLOAD_BODY_BYTES).toBe(55 * 1024 * 1024);
    expect(MAX_UPLOAD_BODY_BYTES).toBeGreaterThan(50 * 1024 * 1024);
  });
});

describe('readBodyWithCap', () => {
  function chunkedRequest(body: BodyInit, extraHeaders: Record<string, string> = {}): Request {
    const headers = { host: 'app.local', ...extraHeaders };
    const req = new Request('http://app.local/api/trpc/csv.import', {
      method: 'POST',
      headers,
      body,
    });
    // Constructed Requests never carry Content-Length — exactly the chunked
    // shape this helper exists for.
    expect(req.headers.get('content-length')).toBeNull();
    return req;
  }

  it('returns the request unchanged when it has no body', async () => {
    const req = new Request('http://app.local/api/trpc/x', { method: 'POST' });
    await expect(readBodyWithCap(req, 100)).resolves.toBe(req);
  });

  it('rebuilds a compliant body with method, url and headers intact', async () => {
    const req = chunkedRequest('{"0":{"csvText":"a,b\\n1,2"}}', {
      'content-type': 'application/json',
      'x-custom': 'keep-me',
    });
    const out = await readBodyWithCap(req, 1024);
    expect(out).not.toBeNull();
    expect(out!.method).toBe('POST');
    expect(out!.url).toBe(req.url);
    expect(out!.headers.get('content-type')).toBe('application/json');
    expect(out!.headers.get('x-custom')).toBe('keep-me');
    expect(await out!.text()).toBe('{"0":{"csvText":"a,b\\n1,2"}}');
  });

  it('preserves a multipart content-type boundary across the rebuild', async () => {
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }));
    // Snapshot the multipart bytes + the boundary-bearing content-type the
    // fetch spec generates for a FormData body.
    const preview = new Response(fd);
    const contentType = preview.headers.get('content-type')!;
    const raw = await preview.arrayBuffer();
    const out = await readBodyWithCap(chunkedRequest(raw, { 'content-type': contentType }), 1024);
    expect(out).not.toBeNull();
    expect(out!.headers.get('content-type')).toBe(contentType);
    // formData() round-trips — it would throw without a usable boundary.
    const parsed = await out!.formData();
    expect((parsed.get('file') as File).name).toBe('a.txt');
  });

  it('returns null (and cancels the stream) once the cap is exceeded', async () => {
    // A stream that would happily produce far more than the cap — the helper
    // must bail at the cap instead of draining it.
    let produced = 0;
    const infinite = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(1024).fill(0x78));
      },
    });
    const req = new Request('http://app.local/api/upload', {
      method: 'POST',
      body: infinite,
      // undici requires duplex for streaming request bodies.
      duplex: 'half',
    } as RequestInit);
    await expect(readBodyWithCap(req, 5 * 1024)).resolves.toBeNull();
    // Bailed at the cap, not at stream end: a handful of pulls, not hundreds.
    expect(produced).toBeLessThan(20);
  });

  it('accepts a body exactly at the cap', async () => {
    const payload = 'x'.repeat(1024);
    const out = await readBodyWithCap(chunkedRequest(payload), 1024);
    expect(await out!.text()).toBe(payload);
  });
});

describe('truncateFilenameBytes', () => {
  it('passes names already within the byte budget through untouched', () => {
    expect(truncateFilenameBytes('report.pdf')).toBe('report.pdf');
    // 85 CJK chars = exactly 255 UTF-8 bytes — fits without truncation.
    expect(truncateFilenameBytes('长'.repeat(85))).toBe('长'.repeat(85));
  });

  it('truncates a 60K-char CJK name to at most 255 UTF-8 bytes, keeping the head', () => {
    const name = '长'.repeat(60_000);
    const truncated = truncateFilenameBytes(name);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(255);
    expect(truncated).toBe(name.slice(0, truncated.length));
    expect(truncated.length).toBeGreaterThan(0);
  });

  it('does not leave a stranded high surrogate at the cut', () => {
    // '🎉' is a surrogate pair; force the byte budget to cut between its
    // halves (253 ASCII bytes + the pair = 257 bytes > 256).
    const truncated = truncateFilenameBytes('x'.repeat(253) + '🎉', 256);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(256);
    expect(truncated.endsWith('\uD83C')).toBe(false);
  });

  it('keeps a truncated CJK name round-trippable through attachmentDisposition', () => {
    // The persisted-download DoS in one line: 60K CJK chars used to expand
    // to a ~540KB Content-Disposition. After truncation the header is tiny.
    const truncated = truncateFilenameBytes('长'.repeat(60_000));
    const header = attachmentDisposition(truncated, 'attachment-abc');
    expect(header.length).toBeLessThanOrEqual(1024);
    expect(header).toContain("filename*=UTF-8''");
  });
});

describe('attachmentDisposition', () => {
  it('passes a plain ASCII name through both forms', () => {
    expect(attachmentDisposition('report.pdf', 'attachment-abc.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('moves a CJK name into filename* with the ASCII fallback quoted', () => {
    expect(attachmentDisposition('报告.pdf', 'attachment-abc.pdf')).toBe(
      `attachment; filename="attachment-abc.pdf"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf`,
    );
  });

  it('percent-encodes emoji instead of throwing Invalid character', () => {
    expect(attachmentDisposition('🎉.png', 'attachment-abc.png')).toBe(
      `attachment; filename="attachment-abc.png"; filename*=UTF-8''%F0%9F%8E%89.png`,
    );
  });

  it('scrubs quotes and backslashes from the quoted form', () => {
    expect(attachmentDisposition('my"file\\name.txt', 'attachment-abc.txt')).toBe(
      `attachment; filename="my_file_name.txt"; filename*=UTF-8''my_file_name.txt`,
    );
  });

  it('neutralizes CRLF header injection and scrubs the fallback too', () => {
    expect(attachmentDisposition('ev\ril\r\nX: p.bin', 'att-\rid')).toBe(
      `attachment; filename="ev_il__X: p.bin"; filename*=UTF-8''ev_il__X%3A%20p.bin`,
    );
  });

  it('degrades to the pure-ASCII fallback when the value would blow the length ceiling', () => {
    // 60K CJK chars percent-encode to ~540KB — a value that dodged
    // truncation must not reach the response headers.
    const header = attachmentDisposition('长'.repeat(60_000), 'attachment-abc.pdf');
    expect(header.length).toBeLessThanOrEqual(1024);
    expect(header).toBe(
      `attachment; filename="attachment-abc.pdf"; filename*=UTF-8''attachment-abc.pdf`,
    );
  });

  it('falls back to a bare disposition if even the degraded form is oversized', () => {
    // Pathological caller: a fallback that is itself over the ceiling.
    const header = attachmentDisposition('长'.repeat(60_000), 'f'.repeat(2_000));
    expect(header.length).toBeLessThanOrEqual(1024);
    expect(header).toBe('attachment; filename="attachment"');
  });
});

describe('safeCallbackUrl', () => {
  const ORIGIN = 'http://app.local';

  it('falls back on null/empty', () => {
    expect(safeCallbackUrl(null, ORIGIN)).toBe('/bases');
    expect(safeCallbackUrl('', ORIGIN)).toBe('/bases');
  });

  it('keeps relative paths with query and hash', () => {
    expect(safeCallbackUrl('/bases', ORIGIN)).toBe('/bases');
    expect(safeCallbackUrl('/invite/tok?x=1#top', ORIGIN)).toBe('/invite/tok?x=1#top');
  });

  it('rejects protocol-relative and backslash variants of foreign origins', () => {
    // Browsers normalize "\" to "/", so "/\evil.com" is "//evil.com".
    expect(safeCallbackUrl('//evil.com', ORIGIN)).toBe('/bases');
    expect(safeCallbackUrl('/\\evil.com', ORIGIN)).toBe('/bases');
    expect(safeCallbackUrl('\\\\evil.com', ORIGIN)).toBe('/bases');
  });

  it('rejects control-character smuggling browsers strip before parsing', () => {
    // "/\n/evil.com" → "//evil.com" once the browser drops the newline.
    expect(safeCallbackUrl('/\n/evil.com', ORIGIN)).toBe('/bases');
  });

  it('rejects absolute foreign origins and dangerous schemes', () => {
    expect(safeCallbackUrl('https://evil.com/x', ORIGIN)).toBe('/bases');
    expect(safeCallbackUrl('javascript:alert(1)', ORIGIN)).toBe('/bases');
  });

  it('accepts an absolute same-origin URL, reduced to path+query+hash', () => {
    expect(safeCallbackUrl('http://app.local/bases?x=1', ORIGIN)).toBe('/bases?x=1');
  });

  it('keeps percent-encoded backslashes — a genuine same-origin path', () => {
    // %5C is NOT decoded to "\" by URL parsers, so this stays on our origin.
    expect(safeCallbackUrl('/%5C%5Cevil.com', ORIGIN)).toBe('/%5C%5Cevil.com');
  });
});

describe('readEnvNonNegativeInt', () => {
  const NAME = 'MP_TEST_KNOB';
  const save = process.env[NAME];
  afterEach(() => {
    if (save === undefined) delete process.env[NAME];
    else process.env[NAME] = save;
  });

  it('returns the fallback when unset, blank, malformed or negative', () => {
    // 缺省/胡填/负数都必须收敛到文档默认值，绝不能收敛成"无限制"。
    delete process.env[NAME];
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(7);
    process.env[NAME] = '';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(7);
    process.env[NAME] = '   ';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(7);
    process.env[NAME] = 'lots';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(7);
    process.env[NAME] = '-3';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(7);
  });

  it('accepts 0 and floors non-integer values', () => {
    process.env[NAME] = '0';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(0);
    process.env[NAME] = '4.9';
    expect(readEnvNonNegativeInt(NAME, 7)).toBe(4);
  });
});

describe('createUserConcurrencyLimiter (L-6 download cap)', () => {
  it('caps concurrent slots per user and frees them on release', () => {
    const limiter = createUserConcurrencyLimiter(() => 2);
    expect(limiter.tryAcquire('u1')).toBe(true);
    expect(limiter.tryAcquire('u1')).toBe(true);
    expect(limiter.tryAcquire('u1')).toBe(false); // over the cap
    expect(limiter.tryAcquire('u2')).toBe(true); // caps are per user
    limiter.release('u1');
    expect(limiter.tryAcquire('u1')).toBe(true); // slot returned to the pool
  });

  it('treats 0 as explicitly unlimited', () => {
    const limiter = createUserConcurrencyLimiter(() => 0);
    for (let i = 0; i < 50; i++) expect(limiter.tryAcquire('u1')).toBe(true);
  });

  it('drops the map entry when the last slot is released (no unbounded userId memory)', () => {
    const limiter = createUserConcurrencyLimiter(() => 4);
    limiter.tryAcquire('u1');
    limiter.release('u1');
    limiter.release('u1'); // double-release must not underflow below zero
    expect(limiter.tryAcquire('u1')).toBe(true);
    limiter.release('u1');
  });

  it('resolves the limit per acquire (env knobs apply without rebuilding)', () => {
    let limit = 1;
    const limiter = createUserConcurrencyLimiter(() => limit);
    expect(limiter.tryAcquire('u1')).toBe(true);
    expect(limiter.tryAcquire('u1')).toBe(false);
    limit = 2;
    expect(limiter.tryAcquire('u1')).toBe(true);
  });
});
