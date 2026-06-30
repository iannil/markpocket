import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TRPCProvider } from '@/lib/trpc/client';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'Lightweight self-hosted database',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
