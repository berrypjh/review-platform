import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading run">
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="aspect-video w-full" />
      </div>
    </div>
  );
}
