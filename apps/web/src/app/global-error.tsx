'use client';

// Root-layout crash guard — app/error.tsx only catches errors BELOW the root
// layout; if the layout itself (providers) throws during render, this file
// is the only UI left standing, so it must carry its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Same policy as app/error.tsx: never render error.message.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          {error.digest ? `Reference: ${error.digest}` : 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          style={{
            height: 32,
            padding: '0 12px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid currentColor',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
