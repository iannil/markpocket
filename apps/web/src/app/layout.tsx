import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { TRPCProvider } from '@/lib/trpc/client';
import './globals.css';
import { Geist, Geist_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'Lightweight self-hosted database',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('dark font-sans', geist.variable, geistMono.variable)}>
      <body>
        <TRPCProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
