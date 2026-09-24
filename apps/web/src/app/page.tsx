import type { Metadata } from 'next';
import { connection } from 'next/server';

import { EmptyRuns } from '@/components/review/empty-runs';
import { RunProblemAlert } from '@/components/review/run-problem-alert';
import { RunsTable } from '@/components/review/runs-table';
import { formatRunCount } from '@/lib/format';
import { listRuns, reviewDataDir } from '@/lib/review-data';

export const metadata: Metadata = { title: 'Visual runs' };

/** Runs 화면. 파일시스템을 요청 시점에 읽어야 하므로 `connection()`으로 prerender를 막는다. */
export default async function RunsPage() {
  await connection();
  const dataDir = reviewDataDir();
  const { runs, problems } = await listRuns(dataDir);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Visual runs</h1>
        <p className="text-sm text-muted-foreground">
          {formatRunCount(runs.length)} in <code className="font-mono break-all">{dataDir}</code>
        </p>
      </div>
      {problems.length > 0 && (
        <section aria-label="Runs that could not be loaded" className="space-y-3">
          {problems.map((problem) => (
            <RunProblemAlert key={problem.runId} problem={problem} />
          ))}
        </section>
      )}
      {runs.length > 0 && <RunsTable runs={runs} />}
      {runs.length === 0 && problems.length === 0 && <EmptyRuns dataDir={dataDir} />}
    </div>
  );
}
