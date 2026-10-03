import { and, eq, sql } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

import { attachment, cell, field } from '@/server/db/schema';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';
import { findLiveShare, findSharedView } from '@/server/trpc/routers/public-share';
import {
  attachmentDisposition,
  createFixedWindowRateLimiter,
  readEnvNonNegativeInt,
} from '@/lib/http-guards';

// Public (token-scoped) attachment download for the share page. The member
// route /api/files/[id] requires a session; without this proxy the share
// page's thumbnails 401'd and clicks landed on a raw JSON error.
//
// ACL shape: the token IS the credential (122 bits of entropy, revocable,
// expiring). A file is served only if (a) the share is live, and (b) the
// attachment belongs to the share's base — for view-pinned shares, only if
// the attachment's id appears in that view's visible cells, so a pinned
// view can never become a base-wide file oracle.
//
// Abuse cap: unauthenticated endpoint, so fixed-window rate limit per
// client IP (default 120/min, 0 disables).
const shareFileLimiter = createFixedWindowRateLimiter(
  () => readEnvNonNegativeInt('SHARE_FILE_RATE_LIMIT', 120),
  60_000,
);

function clientIp(req: Request): string {
  // Same trust model as the other http guards: direct socket address, with
  // the standard proxy header honored when present.
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  if (!shareFileLimiter.allow(clientIp(req))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { token, id } = await params;
  const share = await findLiveShare(token);
  if (!share) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [row] = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);
  if (!row || !row.baseId || row.baseId !== share.baseId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // View-pinned shares must not expose files the view's cells don't
  // reference. The cell scan is bounded by the <100k-row design target.
  if (share.viewId) {
    const v = await findSharedView(share);
    if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [hit] = await db
      .select({ one: sql<number>`1` })
      .from(cell)
      .innerJoin(field, eq(cell.fieldId, field.id))
      .where(
        and(
          eq(field.tableId, v.tableId),
          eq(field.type, 'attachment'),
          sql`${cell.value} @> ${JSON.stringify([id])}::jsonb`,
        ),
      )
      .limit(1);
    if (!hit) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Same download hygiene as the member route: always-attachment
  // disposition, nosniff, private caching.
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(row.filename)?.[0] ?? '';
  const headersOut: Record<string, string> = {
    'Content-Type': row.mime,
    'Content-Disposition': attachmentDisposition(row.filename, `attachment-${row.id}${ext}`),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=86400',
  };

  const storage = getStorage();
  if (storage.getStream) {
    let stream: Readable;
    try {
      stream = await storage.getStream(row.storageKey);
    } catch {
      return NextResponse.json({ error: 'Download failed' }, { status: 500 });
    }
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(body, {
      headers: { ...headersOut, 'Content-Length': String(row.size) },
    });
  }
  try {
    const data = await storage.get(row.storageKey);
    return new NextResponse(new Uint8Array(data), { headers: headersOut });
  } catch {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
