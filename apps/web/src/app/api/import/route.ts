import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { cell, field, record } from '@/server/db/schema';
import { db } from '@/server/db';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { parseStringToNumber } from '@/lib/format-number';
import { auth } from '@/server/auth';
import { headers } from 'next/headers';

// Minimal CSV parser (handles quoted fields)
function parseCsv(text: string): string[][] {
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

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const tableId = formData.get('tableId') as string;
  const file = formData.get('file');
  if (!tableId || !(file instanceof File)) {
    return NextResponse.json({ error: 'tableId and file required' }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2)
    return NextResponse.json({ error: 'CSV must have header + data' }, { status: 400 });

  const [headerRow, ...dataRows] = rows;
  const fields = await db.select().from(field).where(eq(field.tableId, tableId));

  // Map CSV columns to fields by name (case-insensitive)
  const colMap: Array<{ colIdx: number; field: (typeof fields)[0] }> = [];
  for (let i = 0; i < headerRow!.length; i++) {
    const name = headerRow![i]!.trim().toLowerCase();
    const f = fields.find((fd) => fd.name.toLowerCase() === name);
    if (f) colMap.push({ colIdx: i, field: f });
  }

  let imported = 0;
  for (const row of dataRows) {
    const recId = randomUUID();
    await db.insert(record).values({ id: recId, tableId, createdBy: session.user.id });
    for (const { colIdx, field: f } of colMap) {
      const raw = row[colIdx]?.trim() ?? '';
      if (!raw) continue;

      let value: unknown = raw;
      if (f.type === FieldType.Number) {
        const n = parseStringToNumber(raw);
        if (n == null) continue;
        value = n;
      } else if (f.type === FieldType.Boolean) {
        value = raw === 'true' || raw === '1';
      } else if (f.type === FieldType.SingleSelect) {
        const choices = (f.options as { choices?: SelectOption[] }).choices ?? [];
        const match = choices.find((c) => c.name.toLowerCase() === raw.toLowerCase());
        if (!match) continue;
        value = match.id;
      } else if (f.type === FieldType.MultiSelect) {
        const choices = (f.options as { choices?: SelectOption[] }).choices ?? [];
        const names = raw.split('|').map((s) => s.trim());
        value = names
          .map((n) => choices.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
          .filter(Boolean);
        if (!(value as string[]).length) continue;
      } else if (
        f.type === FieldType.Link ||
        f.type === FieldType.Attachment ||
        f.type === FieldType.User ||
        f.type === FieldType.Expression
      ) {
        continue; // skip degraded
      }

      await db.insert(cell).values({
        id: randomUUID(),
        recordId: recId,
        fieldId: f.id,
        value: value as string | number | boolean | string[],
      });
    }
    imported++;
  }

  return NextResponse.json({ imported });
}
