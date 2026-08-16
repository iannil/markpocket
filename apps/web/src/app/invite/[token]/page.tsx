'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: inv, isLoading } = trpc.invite.resolve.useQuery({ token });
  const accept = trpc.invite.accept.useMutation({
    onSuccess: (res) => router.push(`/bases/${res.baseId}`),
    onError: (err) => {
      // If not logged in, redirect to login with callbackUrl
      if (err.data?.code === 'UNAUTHORIZED') {
        router.push(`/login?callbackUrl=/invite/${token}`);
        return;
      }
      setError(err.message);
    },
  });
  const [error, setError] = useState<string | null>(null);
  const hasAttempted = useRef(false);

  // If a signed-in user opened this and it's valid, accept immediately.
  useEffect(() => {
    if (inv && !isLoading && !accept.isPending && !hasAttempted.current) {
      hasAttempted.current = true;
      accept.mutate({ token });
    }
  }, [inv, isLoading, accept.isPending, token, accept]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
        {isLoading ? (
          <div className="h-8 animate-pulse rounded bg-muted" />
        ) : !inv ? (
          <>
            <h1 className="text-sm font-semibold text-destructive">Invite invalid or expired</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              This invite link may have expired or been revoked.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-sm font-semibold">You're invited to {inv.baseName}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Role: <span className="font-medium text-foreground">{inv.role}</span> · Sign in as{' '}
              <span className="font-medium text-foreground">{inv.email}</span> to join.
            </p>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
