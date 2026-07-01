import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { get } from '@/server/storage/local';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const data = await get(row.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': `inline; filename="${row.filename}"`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
