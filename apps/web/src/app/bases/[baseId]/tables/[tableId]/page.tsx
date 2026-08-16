import { GridEditor } from './grid-editor';

export default async function TableGridPage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}) {
  const { baseId, tableId } = await params;
  return <GridEditor baseId={baseId} tableId={tableId} />;
}
