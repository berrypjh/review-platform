import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Run not found</h1>
      <p className="text-sm text-muted-foreground">
        There is no run with this id in the review data directory.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to runs</Link>
      </Button>
    </div>
  );
}
