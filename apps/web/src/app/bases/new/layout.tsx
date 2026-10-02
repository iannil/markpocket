import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'New base',
};

export default function NewBaseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
