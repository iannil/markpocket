// Pure guards for the HTTP edge (API route handlers, login redirect). Kept
// dependency-free and side-effect-free so they unit-test without any Next.js
// runtime piece (next/headers, server db, …) — the route files stay thin
// because Next.js forbids arbitrary extra exports from route/page modules.

// ---------------------------------------------------------------------------
// Env-tunable numeric knobs
// ---------------------------------------------------------------------------

// Reads a non-negative integer env knob: unset/blank/malformed/negative all
// fall back to `fallback` (fail-closed toward the documented default, never
// toward "no limit"). 0 is a valid value — each knob documents what it means
// there (upload quota and download concurrency both treat 0 as "unlimited").
export function readEnvNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// ---------------------------------------------------------------------------
// Per-user concurrency limiter (download path, L-6)
// ---------------------------------------------------------------------------

// A minimal counting semaphore keyed by user id. In-process by design: the
// deployment story is a single self-hosted instance (compose, one container),
// so a Map in module scope IS the instance-wide truth — a restart resets it,
// which is fine for a coarse abuse brake rather than an accounting guarantee.
// The limit is resolved through `getLimit` on every acquire so tests (and
// env reloads) can tune it without rebuilding the map.
export interface UserConcurrencyLimiter {
  /** Reserves one slot for `userId`; false means the cap is reached (429). */
  tryAcquire(userId: string): boolean;
  /**
   * Returns a slot. MUST be called exactly once per successful tryAcquire —
   * route callers release from the response body's terminal event (stream
   * close/error), not from the handler's return: the body keeps draining
   * after the handler returns, and that draining is the memory the cap exists
   * to bound.
   */
  release(userId: string): void;
}

export function createUserConcurrencyLimiter(getLimit: () => number): UserConcurrencyLimiter {
  const counts = new Map<string, number>();
  return {
    tryAcquire(userId) {
      const limit = getLimit();
      if (limit <= 0) return true; // 0 = 不限流（显式关闭）
      const n = counts.get(userId) ?? 0;
      if (n >= limit) return false;
      counts.set(userId, n + 1);
      return true;
    },
    release(userId) {
      const n = counts.get(userId) ?? 0;
      // delete（而不是归零）让空闲用户不占 Map 条目 —— 无界的 userId 空间
      // 不能留下无界的计数器条目。
      if (n <= 1) counts.delete(userId);
      else counts.set(userId, n - 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Request body size gates
// ---------------------------------------------------------------------------

// Checked from Content-Length BEFORE any parsing: the tRPC adapter and
// req.formData() buffer/JSON.parse the whole body first, and public
// procedures validate input only after that. A missing header (chunked
// transfer encoding) cannot be judged from headers alone — those requests
// take the readBodyWithCap path below, which counts the streamed bytes.
export function contentLengthExceeds(req: { headers: Headers }, maxBytes: number): boolean {
  const raw = req.headers.get('content-length');
  if (raw === null) return false;
  const bytes = Number(raw);
  // Malformed values are not this gate's error to report — pass through and
  // let the real parser deal with the actual body.
  return Number.isFinite(bytes) && bytes > maxBytes;
}

// tRPC payloads must stay above the largest legitimate input: plugin-csv
// ships csvText through a tRPC mutation whose field cap is 5MB of UTF-8
// bytes (a byte check, not zod's code-unit .max() — see
// packages/plugin-csv/src/server.ts). The JSON envelope can double the
// payload in the worst case — every quote, backslash or newline in the CSV
// escapes to two bytes — so 12MB = 2×5MB + envelope headroom. CJK text is
// 3 bytes/char but is already held to the 5MB byte budget by the zod check
// itself. Lower this only together with that cap.
export const MAX_TRPC_BODY_BYTES = 12 * 1024 * 1024;

// Multipart envelope around a single 50MB file (boundary + part headers) —
// 55MB rejects clearly-oversized uploads before req.formData() buffers them.
export const MAX_UPLOAD_BODY_BYTES = 55 * 1024 * 1024;

// Agent-access payloads (REST /api/v1, MCP /api/mcp): JSON envelopes whose
// largest legitimate member is a record's cells map — bounded per-cell by the
// 256KB cell-value cap with at most a few hundred fields. 1MB is comfortably
// above that and far below the tRPC budget: agent endpoints are unauthenticated
// at the edge (token resolved AFTER the cap check), so their budget stays tight.
export const MAX_API_BODY_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Fixed-window rate limiter (agent access)
// ---------------------------------------------------------------------------

// Counting fixed window keyed by an opaque id (API token id). Same
// in-process-single-container tradeoff as createUserConcurrencyLimiter above:
// a Map in module scope IS the instance-wide truth; 0 disables the limit
// (explicit opt-out, same convention as the other knobs).
export interface FixedWindowRateLimiter {
  /** Registers one event; false means the window is exhausted (429). */
  allow(key: string, now?: number): boolean;
}
export function createFixedWindowRateLimiter(
  getLimit: () => number,
  windowMs: number,
): FixedWindowRateLimiter {
  const hits = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key, now = Date.now()) {
      const limit = getLimit();
      if (limit <= 0) return true; // 0 = 不限流（显式关闭）
      const entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        // Prune opportunistic expired entries on window rollover so an
        // unbounded key space (token ids) can't accumulate stale windows.
        if (hits.size > 10_000) {
          for (const [k, v] of hits) {
            if (now - v.windowStart >= windowMs) hits.delete(k);
          }
        }
        hits.set(key, { windowStart: now, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-site request gate
// ---------------------------------------------------------------------------

// Browsers always attach Origin to cross-site POSTs; it must point back at the
// host serving the request, or the ambient credential (session cookie on the
// tRPC path) would ride along. Missing Origin (curl, agents, tests) is allowed.
// Agent endpoints authenticate by Bearer token rather than cookie, but the same
// check keeps a browser-based client from being aimed at them with a stolen
// token. Same rule as the tRPC/upload routes — canonicalized here for the
// agent-access endpoints (ADR-0010); older routes keep their local copies.
export function originAllowed(req: { headers: Headers }): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients
  const host = req.headers.get('host');
  try {
    const originHost = new URL(origin).host;
    return originHost.length > 0 && !!host && originHost === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chunked (Content-Length-less) body reads
// ---------------------------------------------------------------------------

// Requests that DO carry Content-Length take the header fast path above —
// no buffering needed. Chunked transfer encoding carries no Content-Length,
// and the default deployment exposes the app directly (compose, port 3000,
// no reverse proxy), so nothing else caps the body: fetchRequestHandler and
// req.formData() would buffer the whole stream before any procedure-level
// limit runs, letting a chunked request OOM the 1g container. This reads
// the stream chunk-by-chunk with a byte counter; over the cap it cancels
// the stream and returns null (caller answers 413), under it rebuilds a
// Request from the buffered bytes. Method and headers are carried over
// verbatim — content-type matters, because a multipart/form-data boundary
// lives in the header and the rebuilt request must stay formData()-parseable.
export async function readBodyWithCap(req: Request, maxBytes: number): Promise<Request | null> {
  if (req.body === null) return req; // GET/HEAD or an empty POST — nothing to cap.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancel so the sender stops transmitting the rest into a void.
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// Upload filename hygiene
// ---------------------------------------------------------------------------

// 255 bytes: the classic filesystem NAME_MAX. Truncating (instead of
// rejecting) keeps the upload usable — but the truncation is what keeps the
// download alive too: RFC 5987 percent-encoding inflates CJK ~9x (3 UTF-8
// bytes become 9 "%XX" chars), so a 60K-char CJK name would otherwise turn
// into a ~540KB Content-Disposition and a permanently broken attachment.
export const MAX_FILENAME_BYTES = 255;

export function truncateFilenameBytes(name: string, maxBytes: number = MAX_FILENAME_BYTES): string {
  if (Buffer.byteLength(name, 'utf8') <= maxBytes) return name;
  // Every code unit costs at least 1 UTF-8 byte, so the fitting prefix is at
  // most `maxBytes` units — start there and back off unit by unit until the
  // byte budget fits. Simplicity over precision: the extension may fall off
  // the end, which is the accepted trade-off for never rejecting the upload.
  let prefix = name.slice(0, maxBytes);
  while (prefix.length > 0 && Buffer.byteLength(prefix, 'utf8') > maxBytes) {
    prefix = prefix.slice(0, -1);
  }
  // A cut can strand the high half of a surrogate pair at the end. Postgres
  // and encodeURIComponent would both mangle a lone surrogate; dropping it
  // costs one character and keeps the stored name clean.
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return prefix;
}

// ---------------------------------------------------------------------------
// Content-Disposition for attachment downloads
// ---------------------------------------------------------------------------

// Node's HTTP layer rejects non-latin1 bytes in header values ("Invalid
// character" → the download 500s), so CJK/emoji filenames cannot travel in
// the quoted filename= form. RFC 5987: the real name goes percent-encoded
// into filename*, filename= carries an ASCII-only fallback. When the original
// name contains any non-ASCII char the fallback is the caller's safe name
// (attachment id + extension) — better than an underscore-mangled string.
// CRLF/quote/backslash are scrubbed from both forms: header injection and
// escaping inside the quoted-string.
//
// Defensive ceiling on the final value: percent-encoding inflates non-ASCII
// 3–9x, and a name that dodged truncation (legacy rows, future writers)
// must not smuggle a ~540KB header into the response. Over the cap the
// whole header degrades to the pure-ASCII fallback — short by construction
// (attachment id + extension) — so the download still works, just without
// the pretty name.
const MAX_DISPOSITION_LENGTH = 1024;

export function attachmentDisposition(filename: string, asciiFallback: string): string {
  const scrub = (s: string) => s.replace(/[\r\n"\\]/g, '_');
  const sanitized = scrub(filename);
  const fallback = scrub(asciiFallback);
  const quoted = /^[\x20-\x7E]*$/.test(sanitized) ? sanitized : fallback;
  const full = `attachment; filename="${quoted}"; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
  if (full.length <= MAX_DISPOSITION_LENGTH) return full;
  const degraded = `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fallback)}`;
  return degraded.length <= MAX_DISPOSITION_LENGTH ? degraded : 'attachment; filename="attachment"';
}

// ---------------------------------------------------------------------------
// Post-login redirect target
// ---------------------------------------------------------------------------

// Redirect targets after login must stay same-origin. Blocklist checks
// ("starts with / but not //") miss the "/\evil.com" variant — browsers
// normalize "\" to "/" — and control characters browsers strip before URL
// parsing ("/\n/evil.com" becomes "//evil.com"). Resolving against the real
// origin and comparing origins closes the whole class; relative paths keep
// working (returned as pathname+search+hash).
export function safeCallbackUrl(raw: string | null, origin: string, fallback = '/bases'): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
