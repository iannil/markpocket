import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { PublicForm } from '@/components/forms/public-form';
import { getPublicForm } from '@/server/forms/submission';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function FormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let config;
  try {
    config = await getPublicForm(token);
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicForm token={token} config={config} />
    </main>
  );
}
