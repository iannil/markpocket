import { redirect } from 'next/navigation';

// The settings root used to BE the Tables tab, which buried the most common
// setting (renaming the base) four tabs deep. General is the landing tab now;
// Tables lives at /settings/tables.
export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ baseId: string }>;
}) {
  const { baseId } = await params;
  redirect(`/bases/${baseId}/settings/general`);
}
