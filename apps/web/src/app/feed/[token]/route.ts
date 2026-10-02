import { eq } from 'drizzle-orm';

import { listRecordsPivoted } from '@/lib/db-queries';
import { compileFilter } from '@/lib/view-query';
import { db } from '@/server/db';
import { base as baseTable, field as fieldTable, table as tableTable } from '@/server/db/schema';
import { findLiveShare, findSharedView } from '@/server/trpc/routers/public-share';
import {
  buildRssFeed,
  describeRecord,
  describeValue,
  type RssItem,
} from '@/server/agent-access/rss';

export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 100;

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// GET /feed/{shareToken}?limit=50 — RSS 2.0 of a PUBLIC SHARE pinned to a
// view (ADR-0010). Shares not pinned to a view are rejected: a feed is an
// unauthenticated pull surface, and "everything in this base" is wider than
// any single view's filter would ever grant. All share rules (expiry, view
// deleted, stale options → fail closed) mirror the public share page because
// they're the same functions.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const share = await findLiveShare(token);
  if (!share || !share.viewId) return notFound();
  const view = await findSharedView(share);
  if (!view) return notFound();

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? FEED_DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), FEED_MAX_LIMIT)
    : FEED_DEFAULT_LIMIT;

  const [baseRow] = await db
    .select({ name: baseTable.name })
    .from(baseTable)
    .where(eq(baseTable.id, share.baseId))
    .limit(1);
  const [tableRow] = await db
    .select({ name: tableTable.name })
    .from(tableTable)
    .where(eq(tableTable.id, view.tableId))
    .limit(1);

  const fields = await db
    .select({
      id: fieldTable.id,
      name: fieldTable.name,
      type: fieldTable.type,
      options: fieldTable.options,
    })
    .from(fieldTable)
    .where(eq(fieldTable.tableId, view.tableId));
  fields.sort((a, b) => a.name.localeCompare(b.name)); // orderIndex is uniform today

  // Hidden fields are dropped from the item summary, but the filter compiles
  // against the FULL field map — a condition on a hidden field keeps
  // filtering (same rule as the public share read path).
  const viewOptions = view.options;
  const hidden = new Set((viewOptions.hiddenFields ?? []) as string[]);
  const visibleFields = fields.filter((f) => !hidden.has(f.id));
  const fieldsById = new Map(
    fields.map((f) => [f.id, { type: f.type, options: f.options as Record<string, unknown> }]),
  );
  const whereFrag = compileFilter(viewOptions.filter, fieldsById);

  // Feeds are "what's new" surfaces: the view's filter and projection apply,
  // but ordering is always newest-record-first regardless of the view's sort.
  const records = await listRecordsPivoted(view.tableId, { where: whereFrag }, 0, limit);

  // Record title heuristic matches the grid's link-cell display rule: first
  // text field, else first field, else the record id.
  const titleField = visibleFields.find((f) => f.type === 'text') ?? visibleFields[0] ?? null;

  const shareUrl = `${url.origin}/share/${token}`;
  const items: RssItem[] = records.map((r) => ({
    title: titleField ? describeValue(r.cells[titleField.id], 120) : r.id,
    link: shareUrl,
    description: describeRecord(visibleFields, r.cells),
    guid: r.id,
    pubDate: new Date(r.createdAt),
  }));

  const xml = buildRssFeed(
    {
      title: `${baseRow?.name ?? 'markpocket'} · ${tableRow?.name ?? 'Table'}`,
      link: shareUrl,
      description: 'markpocket shared view feed',
    },
    items,
  );

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  });
}
