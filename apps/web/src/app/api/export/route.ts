import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { field, table } from '@/server/db/schema';
import { db } from '@/server/db';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString } from '@/lib/format-number';
import { listRecordsPivoted } from '@/lib/db-queries';
import { auth } from '@/server/auth';
import { headers } from 'next/headers';

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function cellToCsv(value: unknown, type: string, options: Record<string, unknown>): string {
  if (value == null) return '';
  switch (type) {
    case FieldType.Number:
      return formatNumberToString(value as number, options as { precision?: number });
    case FieldType.Boolean:
      return value ? 'true' : 'false';
    case FieldType.SingleSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      return choices.find((c) => c.id === value)?.name ?? '';
    }
    case FieldType.MultiSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      const ids = (value as string[]) ?? [];
      return ids
        .map((id) => choices.find((c) => c.id === id)?.name ?? '')
        .filter(Boolean)
        .join('|');
    }
    case FieldType.Link:
    case FieldType.Attachment:
    case FieldType.User:
    case FieldType.Expression:
      return ''; // degraded — import ignores
    default:
      return String(value);
  }
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tableId = searchParams.get('tableId');
  if (!tableId) return NextResponse.json({ error: 'tableId required' }, { status: 400 });

  const [tableRow] = await db.select().from(table).where(eq(table.id, tableId)).limit(1);
  const fields = await db
    .select()
    .from(field)
    .where(eq(field.tableId, tableId))
    .orderBy(field.orderIndex);
  const records = await listRecordsPivoted(tableId, {}, 0, 10000);

  const header = fields.map((f) => csvEscape(f.name)).join(',');
  const lines = records.map((r) =>
    fields
      .map((f) => csvEscape(cellToCsv(r.cells[f.id], f.type, f.options as Record<string, unknown>)))
      .join(','),
  );

  const csv = [header, ...lines].join('\n');
  const filename = (tableRow?.name ?? 'export').replace(/[^a-zA-Z0-9_-]/g, '_');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
}
