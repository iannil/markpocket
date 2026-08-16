'use client';

import { redirect } from 'next/navigation';
import { useParams } from 'next/navigation';

export default function HistoryTab() {
  const { baseId } = useParams<{ baseId: string }>();
  redirect(`/bases/${baseId}/history`);
}
