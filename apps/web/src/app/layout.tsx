// apps/web/src/app/layout.tsx
import type { Metadata } from 'next';
import '@/app/globals.css';
import { TRPCProvider } from '@/lib/trpc/client';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { Toaster } from '@/components/toaster';

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'the airtable you own',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <TRPCProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </TRPCProvider>
        <Toaster />
      </body>
    </html>
  );
}
