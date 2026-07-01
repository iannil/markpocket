import { randomUUID } from 'node:crypto';

import { attachment } from '@/server/db/schema';
import { db } from '@/server/db';
import { makeKey, put } from '@/server/storage/local';
import { auth } from '@/server/auth';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

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

  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = makeKey(file.name);
  await put(key, buf);

  const [row] = await db
    .insert(attachment)
    .values({
      id: randomUUID(),
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      storageKey: key,
      uploadedBy: session.user.id,
    })
    .returning();

  return NextResponse.json({ id: row!.id, filename: row!.filename });
}
