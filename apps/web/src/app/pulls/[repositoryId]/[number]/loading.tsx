import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading pull request">
      <div className="space-y-4">
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
