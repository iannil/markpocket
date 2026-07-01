import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { get } from '@/server/storage/local';
import { auth } from '@/server/auth';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db.select().from(attachment).where(eq(attachment.id, id)).limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const data = await get(row.storageKey);
  const safeFilename = row.filename.replace(/[\r\n"]/g, '_');
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': `inline; filename="${safeFilename}"`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
