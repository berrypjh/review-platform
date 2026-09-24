'use client';

import { CircleX } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * 예상하지 못한 실패만 여기로 온다. run 단위의 contract·파일시스템 문제는 각 page가 값으로 받아 직접 그린다.
 * production에서는 error.message가 일반 문구로 바뀌므로 digest만 보여주고 서버 로그로 안내한다.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Review data could not be loaded</h1>
      <Alert variant="destructive">
        <CircleX aria-hidden="true" />
        <AlertTitle>Unexpected error</AlertTitle>
        <AlertDescription>
          <p>
            The review data directory could not be read. Check that REVIEW_DATA_DIR points to a
            readable directory and see the server log for details.
          </p>
          {error.digest && (
            <p>
              Error reference: <code className="font-mono">{error.digest}</code>
            </p>
          )}
        </AlertDescription>
      </Alert>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
