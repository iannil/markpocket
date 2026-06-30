import { GridEditor } from './grid-editor';

export default async function TableGridPage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}) {
  const { tableId } = await params;
  return <GridEditor tableId={tableId} />;
}
