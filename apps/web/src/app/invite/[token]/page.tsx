'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: inv, isLoading, isError } = trpc.invite.resolve.useQuery({ token });
  const [error, setError] = useState<string | null>(null);
  const accept = trpc.invite.accept.useMutation({
    onSuccess: (res) => router.push(`/bases/${res.baseId}`),
    onError: (err) => {
      // Not signed in → log in and come back (the button re-appears post-login).
      if (err.data?.code === 'UNAUTHORIZED') {
        router.push(`/login?callbackUrl=/invite/${token}`);
        return;
      }
      setError(err.message);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
        {isLoading ? (
          <div className="h-8 animate-pulse rounded bg-muted" />
        ) : !inv ? (
          <>
            <h1 className="text-sm font-semibold text-destructive">Invite invalid or expired</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {isError
                ? 'Could not load this invite. Check your connection and retry.'
                : 'This invite link may have expired or been revoked.'}
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
            <button
              type="button"
              className="mt-4 h-8 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={() => accept.mutate({ token })}
              disabled={accept.isPending}
            >
              {accept.isPending ? '···' : 'Accept invite'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
