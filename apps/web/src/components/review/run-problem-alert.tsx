import { CircleX, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { RunProblem } from '@/lib/review-data';

const PROBLEM_TITLE: Record<RunProblem['reason'], string> = {
  'not-found': 'Run not found',
  'not-compared': 'Not compared yet',
  'invalid-contract': 'Invalid run.json',
  filesystem: 'Could not read run.json',
};

/** run을 보여주지 못한 이유. contract 위반과 파일시스템 오류를 제목으로 구분하고, 미비교 run은 경고 톤으로 낮춘다. */
export function RunProblemAlert({ problem }: { problem: RunProblem }) {
  const isPending = problem.reason === 'not-compared';
  const Icon = isPending ? TriangleAlert : CircleX;
  return (
    <Alert variant={isPending ? 'default' : 'destructive'}>
      <Icon aria-hidden="true" />
      <AlertTitle>
        {PROBLEM_TITLE[problem.reason]}: <span className="font-mono">{problem.runId}</span>
      </AlertTitle>
      <AlertDescription>
        <p className="break-words">{problem.detail}</p>
        {isPending && (
          <p>
            Run <code className="font-mono">pnpm visual:compare</code> for this run to create it.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
