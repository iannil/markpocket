// RSS 2.0 builder for the agent access layer (ADR-0010). Pure string work —
// no db, no Next.js — so escaping is unit-testable in isolation. Feeds ride
// on base_share tokens pinned to a view; the route applies the same
// fail-closed share semantics as the public share page.

export interface RssItem {
  title: string;
  link: string;
  description: string;
  guid: string;
  pubDate: Date;
}

export interface RssChannel {
  title: string;
  link: string;
  description: string;
}

/** XML 1.0 entity escaping + removal of characters illegal in XML 1.0. */
export function escapeXml(input: string): string {
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  // XML 1.0 allows tab/newline/CR plus everything from U+0020 up; stripping
  // the rest keeps control characters from making the whole feed unparseable.
  // (eslint-disable: the control chars are the point of this regex.)
  // eslint-disable-next-line no-control-regex
  return escaped.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** RFC 822 date (RSS spec format), always in UTC. */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

export function buildRssFeed(channel: RssChannel, items: RssItem[]): string {
  const itemsXml = items
    .map((item) => {
      const title = escapeXml(item.title || '(untitled)');
      return [
        '    <item>',
        `      <title>${title}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <description>${escapeXml(item.description)}</description>`,
        `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
        `      <pubDate>${rfc822(item.pubDate)}</pubDate>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>`,
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/**
 * Human summary of one record for the description field: "FieldName: value"
 * lines in field order, bounded per line and in total so a wide table can't
 * generate megabyte items. Cells are keyed by field id (the storage model);
 * pass the visible fields with their ids.
 */
export function describeRecord(
  fields: Array<{ id: string; name: string }>,
  cells: Record<string, unknown>,
  opts: { maxLineLength?: number; maxLines?: number } = {},
): string {
  const maxLineLength = opts.maxLineLength ?? 200;
  const maxLines = opts.maxLines ?? 30;
  const lines: string[] = [];
  for (const field of fields) {
    if (lines.length >= maxLines) {
      lines.push('…');
      break;
    }
    lines.push(`${field.name}: ${describeValue(cells[field.id], maxLineLength)}`);
  }
  return lines.join('\n');
}

export function describeValue(value: unknown, maxLineLength: number): string {
  let text: string;
  if (value === null || value === undefined || value === '') {
    text = '—';
  } else if (Array.isArray(value)) {
    text = value.map((v) => describeValue(v, maxLineLength)).join(', ');
  } else if (typeof value === 'object') {
    text = JSON.stringify(value) ?? '—';
  } else {
    text = String(value);
  }
  if (text.length > maxLineLength) text = `${text.slice(0, maxLineLength)}…`;
  return text;
}
