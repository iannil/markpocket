import { EmptyState } from '@/components/empty-state';

// Segment-level 404: notFound() thrown by bases/[baseId]/layout's membership
// gate renders here — with the workspace shell still mounted, instead of the
// app-level full-page 404.
export default function BaseNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <EmptyState
        as="h2"
        title="Base not found"
        description="This base doesn’t exist, or you don’t have access to it."
      />
    </div>
  );
}
