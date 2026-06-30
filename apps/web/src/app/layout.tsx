import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TRPCProvider } from '@/lib/trpc/client';
import './globals.css';

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'Lightweight self-hosted database',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
