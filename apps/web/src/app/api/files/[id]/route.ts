import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';
import { auth } from '@/server/auth';
import { getMembership } from '@/lib/roles';
import {
  attachmentDisposition,
  createUserConcurrencyLimiter,
  readEnvNonNegativeInt,
} from '@/lib/http-guards';
import { eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

// Per-user concurrent-download cap (L-6): the old path read the whole file
// into memory, so N parallel downloads of a 50MB attachment could pin N×50MB
// and OOM the 1g container. In-process counting semaphore — 单实例进程内限流，
// 重启即重置，对单租户自托管部署足够（多实例部署需换共享存储计数器，当前
// 部署形态不存在该场景）。DOWNLOAD_CONCURRENCY_LIMIT: per-user concurrent
// downloads, default 4, 0 disables the cap. Over the cap → 429.
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
const downloadSlots = createUserConcurrencyLimiter(() =>
  readEnvNonNegativeInt('DOWNLOAD_CONCURRENCY_LIMIT', DEFAULT_DOWNLOAD_CONCURRENCY),
);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Per-object ACL: members of the owning base (viewer+) may download. Rows from
  // before base_id existed fall back to uploader-only access.
  if (row.baseId) {
    const role = await getMembership(row.baseId, session.user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (row.uploadedBy !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Reserve a download slot AFTER authz (no state for unauthenticated /
  // forbidden callers) but BEFORE opening the stream — the streamed body is
  // the memory the cap bounds.
  if (!downloadSlots.tryAcquire(session.user.id)) {
    return NextResponse.json({ error: 'Too many concurrent downloads' }, { status: 429 });
  }

  // ASCII-safe fallback (id + short alnum extension) for names that cannot
  // travel in the quoted header form — see attachmentDisposition.
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(row.filename)?.[0] ?? '';
  const headersOut: Record<string, string> = {
    'Content-Type': row.mime,
    // Always download, never render inline — a malicious upload must not
    // execute in the app's origin. <img> previews still work with this.
    'Content-Disposition': attachmentDisposition(row.filename, `attachment-${row.id}${ext}`),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=86400',
  };

  const storage = getStorage();
  if (storage.getStream) {
    // Streaming path (L-6): chunks flow from disk to the socket; peak memory
    // is one chunk instead of the whole file. Content-Length keeps the
    // download semantics the buffered path had (progress bars, exact framing)
    // — row.size is the authoritative upload-time size.
    let stream: Readable;
    try {
      stream = await storage.getStream(row.storageKey);
    } catch {
      downloadSlots.release(session.user.id);
      return NextResponse.json({ error: 'Download failed' }, { status: 500 });
    }
    // The slot must outlive this handler's return: the body keeps draining
    // after we hand the Response back. 'close' is the single reliable
    // terminal event on a fs.ReadStream — it fires on normal end, on error,
    // AND on client cancellation (Readable.toWeb destroys the source). once()
    // + the flag make double-release impossible.
    let released = false;
    stream.once('close', () => {
      if (!released) {
        released = true;
        downloadSlots.release(session.user.id);
      }
    });
    // node:stream/web and the DOM-global ReadableStream are the same
    // implementation at runtime; the cast is purely for the Response type.
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(body, {
      headers: { ...headersOut, 'Content-Length': String(row.size) },
    });
  }

  // Buffered fallback for storage providers without getStream (the SDK marks
  // it optional): the file is fully materialized before the response, so the
  // slot is returned as soon as the read completes — NextResponse owns the
  // Uint8Array from here.
  try {
    const data = await storage.get(row.storageKey);
    return new NextResponse(new Uint8Array(data), { headers: headersOut });
  } catch {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  } finally {
    downloadSlots.release(session.user.id);
  }
}
