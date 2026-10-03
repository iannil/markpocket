import { randomUUID } from 'node:crypto';

import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';
import { auth } from '@/server/auth';
import { assertRole } from '@/lib/roles';
import {
  contentLengthExceeds,
  MAX_UPLOAD_BODY_BYTES,
  originAllowed,
  readBodyWithCap,
  readEnvNonNegativeInt,
  truncateFilenameBytes,
} from '@/lib/http-guards';
import { eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

// Uploads are limited to types that are safe to serve and round-trip. Anything
// executable in a browser context (html/svg/xml) is refused — combined with the
// attachment disposition + nosniff on download this closes stored XSS.
const ALLOWED_MIME_RE =
  /^(image\/(png|jpeg|gif|webp|bmp|x-icon|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/(plain|csv|markdown)|application\/(pdf|zip|json|octet-stream|msword|vnd\.[a-z0-9.+-]+|vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+))$/i;

// UPLOAD_USER_QUOTA_MB: per-user total upload quota in megabytes. Default
// 2048, 0 disables the cap. See the quota check in POST for the threat model.
const DEFAULT_UPLOAD_USER_QUOTA_MB = 2048;

export async function POST(req: Request) {
  // Cross-origin browser POSTs (CSRF) are refused: a browser always sends
  // Origin on cross-origin fetches. Missing Origin (curl, tests, server-side
  // clients) is allowed through — session auth still applies. Canonical copy:
  // http-guards.originAllowed (ADR-0010).
  if (!originAllowed(req)) {
    return NextResponse.json({ error: 'Cross-origin upload refused' }, { status: 403 });
  }

  // Reject on Content-Length BEFORE req.formData() buffers the entire body —
  // the per-file check below only runs after the buffering happened. Missing
  // header (chunked encoding) cannot be judged from headers: count the
  // streamed bytes first (readBodyWithCap) so a chunked client cannot buffer
  // an unbounded body either. The authoritative per-file check below still
  // governs the actual file size.
  if (contentLengthExceeds(req, MAX_UPLOAD_BODY_BYTES)) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
  }

  // Authenticate BEFORE the chunked-buffering path: readBodyWithCap holds up
  // to MAX_UPLOAD_BODY_BYTES in memory, and it must only ever do that for a
  // caller with a session — unauthenticated chunked uploads would otherwise
  // be buffered in full (an OOM vector on the default no-proxy deployment).
  // getSession only reads headers, so it costs nothing to run first.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (req.headers.get('content-length') === null) {
    const capped = await readBodyWithCap(req, MAX_UPLOAD_BODY_BYTES);
    if (capped === null) {
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
    }
    req = capped;
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 });
  }
  const baseId = formData.get('baseId');
  if (typeof baseId !== 'string' || !baseId) {
    return NextResponse.json({ error: 'Missing baseId' }, { status: 400 });
  }

  // Attachments are base-scoped: only members with edit rights may upload.
  try {
    await assertRole(baseId, session.user.id, 'editor');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Authoritative size check on the actual file — catches clients without
  // Content-Length (chunked) or with a lying header.
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME_RE.test(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 });
  }

  // Per-user TOTAL storage quota (M-1 core mitigation): the 50MB per-file cap
  // alone lets any editor fill the disk with unlimited uploads. The check sums
  // the user's persisted attachment sizes and adds this file's size — over the
  // quota means 413 before anything reaches storage or the DB. Read per-request
  // (not at module load) so the knob is testable and applies without a rebuild.
  // Read-then-write is not atomic, so two racing uploads can both pass — the
  // overshoot is at most one file per race, acceptable for a coarse disk brake
  // on a self-hosted single-tenant instance.
  const quotaMb = readEnvNonNegativeInt('UPLOAD_USER_QUOTA_MB', DEFAULT_UPLOAD_USER_QUOTA_MB);
  if (quotaMb > 0) {
    // SUM(int) comes back from Postgres as bigint → string; coalesce keeps
    // first-time uploaders (SUM of no rows = NULL) at 0.
    const [used] = await db
      .select({ total: sql<string>`coalesce(sum(${attachment.size}), 0)` })
      .from(attachment)
      .where(eq(attachment.uploadedBy, session.user.id));
    if (Number(used?.total ?? 0) + file.size > quotaMb * 1024 * 1024) {
      return NextResponse.json(
        { error: `Upload quota exceeded (limit ${quotaMb}MB)` },
        { status: 413 },
      );
    }
  }

  // Storage/filesystem failures (disk full, perms, …) must surface as a
  // structured error, not a bare 500 stack trace.
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    // Cap the persisted name at 255 UTF-8 bytes BEFORE it reaches storage or
    // the DB: RFC 5987 percent-encoding inflates CJK ~9x on download, so a
    // 60K-char name would later render the attachment permanently
    // un-downloadable (see truncateFilenameBytes / attachmentDisposition).
    const filename = truncateFilenameBytes(file.name);
    const storage = getStorage();
    const key = storage.makeKey(filename);
    await storage.put(key, buf);

    const [row] = await db
      .insert(attachment)
      .values({
        id: randomUUID(),
        baseId,
        filename,
        mime,
        size: file.size,
        storageKey: key,
        uploadedBy: session.user.id,
      })
      .returning();

    return NextResponse.json({ id: row!.id, filename: row!.filename });
  } catch (err) {
    console.error('upload failed', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
