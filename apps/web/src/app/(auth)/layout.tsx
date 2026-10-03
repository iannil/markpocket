import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { auth } from '@/server/auth';

// Shared guard for the auth forms: a signed-in visitor landing on /login or
// /register gets routed to the workspace — submitting the form again would
// silently replace a perfectly good session.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect('/bases');
  return children;
}
