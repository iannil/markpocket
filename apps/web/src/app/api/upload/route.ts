import { randomUUID } from 'node:crypto';

import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { getStorage } from '@/server/plugins';
import { auth } from '@/server/auth';
import { assertRole } from '@/lib/roles';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

// Uploads are limited to types that are safe to serve and round-trip. Anything
// executable in a browser context (html/svg/xml) is refused — combined with the
// attachment disposition + nosniff on download this closes stored XSS.
const ALLOWED_MIME_RE =
  /^(image\/(png|jpeg|gif|webp|bmp|x-icon|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/(plain|csv|markdown)|application\/(pdf|zip|json|octet-stream|msword|vnd\.[a-z0-9.+-]+|vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+))$/i;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 });
  }
  const baseId = formData.get('baseId');
  if (typeof baseId !== 'string' || !baseId) {
    return NextResponse.json({ error: 'Missing baseId' }, { status: 400 });
  }

  // Attachments are base-scoped: only members with edit rights may upload.
  try {
    await assertRole(baseId, session.user.id, 'editor');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME_RE.test(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const storage = getStorage();
  const key = storage.makeKey(file.name);
  await storage.put(key, buf);

  const [row] = await db
    .insert(attachment)
    .values({
      id: randomUUID(),
      baseId,
      filename: file.name,
      mime,
      size: file.size,
      storageKey: key,
      uploadedBy: session.user.id,
    })
    .returning();

  return NextResponse.json({ id: row!.id, filename: row!.filename });
}
