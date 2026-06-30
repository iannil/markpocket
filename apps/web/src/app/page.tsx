import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/server/auth';

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? '/bases' : '/login');
}
