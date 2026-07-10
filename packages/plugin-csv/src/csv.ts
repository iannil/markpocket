import type { CoreFieldTypes } from '@markpocket/plugin-sdk';

// —— 逐字来自旧 api/import/route.ts ——
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
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

// —— 逐字来自旧 api/export/route.ts ——
export function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
