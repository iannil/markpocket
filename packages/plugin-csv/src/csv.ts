import type { CoreFieldTypes } from '@markpocket/plugin-sdk';

// Parser kept verbatim from the original REST route, plus a leading-BOM strip
// (Excel/Windows UTF-8 exports start with \uFEFF, which would otherwise corrupt
// the first header cell and silently drop that column on import).
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        cur.push(field);
        field = '';
      } else if (c === '\n') {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else if (c === '\r') {
        /* skip */
      } else field += c;
    }
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Neutralize formula prefixes (= + - @ and tab/CR) with a leading apostrophe so
// Excel/Sheets don't execute the cell (OWASP CSV injection). parseCsv consumers
// strip one leading apostrophe on import, keeping the round-trip intact.
export function csvEscape(s: string): string {
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

// Import-side counterpart of csvEscape: unguard the apostrophe prefix.
export function csvUnguard(s: string): string {
  return s.startsWith("'") ? s.slice(1) : s;
}

const TRUE_LITERALS = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_LITERALS = new Set(['false', '0', 'no', 'n', 'off']);

export function parseCsvBoolean(raw: string): boolean | null {
  const key = raw.trim().toLowerCase();
  if (TRUE_LITERALS.has(key)) return true;
  if (FALSE_LITERALS.has(key)) return false;
  return null;
}

export function cellToCsv(
  value: unknown,
  type: string,
  options: Record<string, unknown>,
  ft: CoreFieldTypes,
): string {
  if (value == null) return '';
  switch (type) {
    case ft.FieldType.Number:
      return ft.formatNumberToString(value as number, options as { precision?: number });
    case ft.FieldType.Boolean:
      return value ? 'true' : 'false';
    case ft.FieldType.SingleSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      return choices.find((c) => c.id === value)?.name ?? '';
    }
    case ft.FieldType.MultiSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      const ids = (value as string[]) ?? [];
      return ids
        .map((id) => choices.find((c) => c.id === id)?.name ?? '')
        .filter(Boolean)
        .join('|');
    }
    case ft.FieldType.Link:
    case ft.FieldType.Attachment:
    case ft.FieldType.User:
    case ft.FieldType.Expression:
      return ''; // 降级——与旧 REST 路由一致
    default:
      return String(value);
  }
}
