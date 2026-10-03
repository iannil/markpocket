import { describe, expect, it } from 'vitest';

import { FieldType } from '@/lib/field-types';
import { firstSegment, formatClipboardValue, parseClipboardValue } from './clipboard';

const field = (type: FieldType, options: Record<string, unknown> = {}) => ({
  id: 'f1',
  type,
  options,
});
const users = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u2', name: null, email: 'bob@example.com' },
];

describe('firstSegment', () => {
  it('takes the first cell of the first line', () => {
    expect(firstSegment('a\tb\nc\td')).toBe('a');
  });

  it('trims surrounding whitespace and newlines', () => {
    expect(firstSegment('  hello \r\nworld')).toBe('hello');
  });

  it('returns empty for blank input', () => {
    expect(firstSegment('   \n  ')).toBe('');
  });
});

describe('parseClipboardValue', () => {
  it('accepts text as-is', () => {
    expect(parseClipboardValue(field(FieldType.Text), users, '  hi there ')).toEqual({
      ok: true,
      value: 'hi there',
    });
  });

  it('coerces numbers and rejects non-numbers', () => {
    expect(parseClipboardValue(field(FieldType.Number), users, ' 42.5 ')).toEqual({
      ok: true,
      value: 42.5,
    });
    const bad = parseClipboardValue(field(FieldType.Number), users, 'abc');
    expect(bad.ok).toBe(false);
  });

  it('limits boolean to true/false', () => {
    expect(parseClipboardValue(field(FieldType.Boolean), users, 'TRUE')).toEqual({
      ok: true,
      value: true,
    });
    expect(parseClipboardValue(field(FieldType.Boolean), users, 'yes').ok).toBe(false);
  });

  it('validates single-select options by name or id', () => {
    const opts = {
      choices: [
        { id: 'c1', name: 'Todo', color: '#000' },
        { id: 'c2', name: 'Done', color: '#111' },
      ],
    };
    expect(parseClipboardValue(field(FieldType.SingleSelect, opts), users, 'todo')).toEqual({
      ok: true,
      value: 'c1',
    });
    expect(parseClipboardValue(field(FieldType.SingleSelect, opts), users, 'c2')).toEqual({
      ok: true,
      value: 'c2',
    });
    expect(parseClipboardValue(field(FieldType.SingleSelect, opts), users, 'nope').ok).toBe(false);
  });

  it('splits multi-select on both | (csv export format) and ,', () => {
    const opts = {
      choices: [
        { id: 'c1', name: 'Todo', color: '#000' },
        { id: 'c2', name: 'Done', color: '#111' },
        { id: 'c3', name: 'Later', color: '#222' },
      ],
    };
    // Round-trip of our own CSV export ("Todo|Done") — used to be rejected.
    expect(parseClipboardValue(field(FieldType.MultiSelect, opts), users, 'Todo|Done')).toEqual({
      ok: true,
      value: ['c1', 'c2'],
    });
    expect(parseClipboardValue(field(FieldType.MultiSelect, opts), users, 'Todo, Done')).toEqual({
      ok: true,
      value: ['c1', 'c2'],
    });
    expect(
      parseClipboardValue(field(FieldType.MultiSelect, opts), users, 'Todo|Done, Later'),
    ).toEqual({ ok: true, value: ['c1', 'c2', 'c3'] });
    // An unknown segment anywhere still rejects the whole paste.
    expect(parseClipboardValue(field(FieldType.MultiSelect, opts), users, 'Todo|nope').ok).toBe(
      false,
    );
  });

  it('parses dates and rejects garbage', () => {
    expect(parseClipboardValue(field(FieldType.Date), users, '2026-10-02')).toEqual({
      ok: true,
      value: '2026-10-02',
    });
    expect(parseClipboardValue(field(FieldType.Date), users, '2026-10-02T10:30')).toEqual({
      ok: true,
      value: '2026-10-02T10:30',
    });
    // V8's lenient parser treats this as "Oct 5" — must still be rejected.
    expect(parseClipboardValue(field(FieldType.Date), users, 'Octopus 5').ok).toBe(false);
    expect(parseClipboardValue(field(FieldType.Date), users, '2026-13-45').ok).toBe(false);
  });

  it('matches users by email or name', () => {
    expect(parseClipboardValue(field(FieldType.User), users, 'ada@example.com')).toEqual({
      ok: true,
      value: 'u1',
    });
    expect(parseClipboardValue(field(FieldType.User), users, 'bob@example.com')).toEqual({
      ok: true,
      value: 'u2',
    });
    expect(parseClipboardValue(field(FieldType.User), users, 'nobody').ok).toBe(false);
  });

  it('rejects computed / server-managed types', () => {
    expect(parseClipboardValue(field(FieldType.Expression), users, '1').ok).toBe(false);
    expect(parseClipboardValue(field(FieldType.Link), users, 'x').ok).toBe(false);
    expect(parseClipboardValue(field(FieldType.Attachment), users, 'x').ok).toBe(false);
  });

  it('rejects empty clipboard content', () => {
    expect(parseClipboardValue(field(FieldType.Text), users, '  ').ok).toBe(false);
  });
});

describe('formatClipboardValue', () => {
  it('serializes primitives, null and empty', () => {
    expect(formatClipboardValue('hi')).toBe('hi');
    expect(formatClipboardValue(3.5)).toBe('3.5');
    expect(formatClipboardValue(true)).toBe('true');
    expect(formatClipboardValue(null)).toBe('');
    expect(formatClipboardValue(undefined)).toBe('');
    expect(formatClipboardValue('')).toBe('');
  });

  it('joins array values with the paste-accepted separator', () => {
    // '|' is what parseClipboardValue accepts back for MultiSelect.
    expect(formatClipboardValue(['a', 'b'])).toBe('a|b');
  });

  it('serializes objects as JSON, never "[object Object]"', () => {
    expect(formatClipboardValue({ __error: 'div by 0' })).toBe('{"__error":"div by 0"}');
  });
});
