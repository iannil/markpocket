import { describe, expect, it } from 'vitest';

import { buildRssFeed, describeRecord, describeValue, escapeXml, type RssItem } from './rss';

describe('escapeXml', () => {
  it('escapes the five predefined entities', () => {
    expect(escapeXml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('strips characters illegal in XML 1.0 but keeps tab/newline/CR', () => {
    expect(escapeXml('a\u0000b\u0008c')).toBe('abc');
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('neutralizes injected markup inside text', () => {
    expect(escapeXml('<script>alert(1)</script>')).not.toContain('<script>');
  });
});

describe('describeValue', () => {
  it('renders empties, arrays and objects readably', () => {
    expect(describeValue(undefined, 50)).toBe('—');
    expect(describeValue('', 50)).toBe('—');
    expect(describeValue(['a', 'b'], 50)).toBe('a, b');
    expect(describeValue({ k: 1 }, 50)).toBe('{"k":1}');
    expect(describeValue(3.5, 50)).toBe('3.5');
  });

  it('truncates long values with an ellipsis', () => {
    expect(describeValue('x'.repeat(300), 200)).toBe(`${'x'.repeat(200)}…`);
  });
});

describe('describeRecord', () => {
  it('summarizes visible fields and caps the line count', () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Field ${i}` }));
    const cells = Object.fromEntries(fields.map((f, i) => [f.id, `v${i}`]));
    const text = describeRecord(fields, cells, { maxLines: 5 });
    expect(text.split('\n')).toHaveLength(6); // 5 lines + ellipsis
    expect(text.split('\n')[0]).toBe('Field 0: v0');
    expect(text.endsWith('…')).toBe(true);
  });

  it('skips hidden fields because the caller filters the field list', () => {
    const text = describeRecord([{ id: 'f1', name: 'Public' }], { f1: 'a', f2: 'secret' });
    expect(text).toBe('Public: a');
  });
});

describe('buildRssFeed', () => {
  const item: RssItem = {
    title: 'Hello <world> & friends',
    link: 'http://app.local/share/tok',
    description: 'Name: "quoted"\nvalue: 42',
    guid: 'r1',
    pubDate: new Date('2026-10-01T12:00:00Z'),
  };

  it('produces a well-formed RSS 2.0 document', () => {
    const xml = buildRssFeed(
      { title: 'Base · Table', link: 'http://app.local/share/tok', description: 'feed' },
      [item],
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<guid isPermaLink="false">r1</guid>');
    expect(xml).toContain('<pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<title>Hello &lt;world&gt; &amp; friends</title>');
    expect(xml).not.toContain('<world>');
  });

  it('emits an empty channel for zero items', () => {
    const xml = buildRssFeed({ title: 'T', link: 'http://x', description: 'd' }, []);
    expect(xml).toContain('<channel>');
    expect(xml).not.toContain('<item>');
  });

  it('falls back to (untitled) for empty titles', () => {
    const xml = buildRssFeed({ title: 'T', link: 'http://x', description: 'd' }, [
      { ...item, title: '' },
    ]);
    expect(xml).toContain('<title>(untitled)</title>');
  });
});
