import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';
import { auth } from '@/server/auth';
import { getMembership } from '@/lib/roles';
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

  // Per-object ACL: members of the owning base (viewer+) may download. Rows from
  // before base_id existed fall back to uploader-only access.
  if (row.baseId) {
    const role = await getMembership(row.baseId, session.user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (row.uploadedBy !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await getStorage().get(row.storageKey);
  const safeFilename = row.filename.replace(/[\r\n"]/g, '_');
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': row.mime,
      // Always download, never render inline — a malicious upload must not
      // execute in the app's origin. <img> previews still work with this.
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
