import type { VisualChange, VisualRun } from '@review-platform/visual-contracts';
import { CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { ChangeViewer } from '@/components/review/change-viewer';
import { DefinitionList } from '@/components/review/definition-list';
import { RunProblemAlert } from '@/components/review/run-problem-alert';
import { StatusBadge } from '@/components/review/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatPixels, formatRatio, formatTimestamp } from '@/lib/format';
import { loadRun, reviewDataDir } from '@/lib/review-data';
import { CHANGE_STATUS_DISPLAY, RUN_STATUS_DISPLAY } from '@/lib/status-display';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ change?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { runId } = await params;
  return { title: `Run ${runId}` };
}

/** `?change=`가 없을 때 처음 보여줄 change. 확인이 필요한 것(changed, error)을 unchanged보다 먼저 고른다. */
const firstToReview = (changes: VisualChange[]) =>
  changes.find((change) => change.status !== 'unchanged') ?? changes[0];

function RunSummary({ run }: { run: VisualRun }) {
  return (
    <DefinitionList
      className="sm:grid-cols-2 xl:grid-cols-3"
      fields={[
        { term: 'Repository', value: run.repository },
        { term: 'Base SHA', value: run.baseSha, mono: true },
        { term: 'Head SHA', value: run.headSha, mono: true },
        { term: 'Browser', value: 'Chromium' },
        { term: 'Viewport', value: `${run.viewport.width} × ${run.viewport.height}` },
        { term: 'Created', value: formatTimestamp(run.createdAt) },
      ]}
    />
  );
}

/** change 목록. 선택은 URL query로 표현하므로 항목은 버튼이 아니라 링크다. */
function ChangeList({ run, selectedId }: { run: VisualRun; selectedId: string }) {
  return (
    <nav aria-labelledby="changes-heading">
      <h2 id="changes-heading" className="mb-3 text-lg font-semibold">
        Changes ({run.changes.length})
      </h2>
      <ul className="space-y-2">
        {run.changes.map((change) => {
          const selected = change.id === selectedId;
          return (
            <li key={change.id}>
              <Link
                href={`/runs/${run.id}?change=${change.id}`}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'block space-y-2 rounded-lg border p-3 text-sm hover:bg-muted',
                  focusRing,
                  selected && 'border-foreground bg-muted',
                )}
              >
                <span className="block font-medium">{change.label}</span>
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <StatusBadge display={CHANGE_STATUS_DISPLAY[change.status]} />
                  <span>{formatPixels(change.mismatchPixels)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRatio(change.mismatchRatio)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Run Review 화면. run.json이 없거나 깨진 경우는 404 대신 이유를 설명하는 alert로 보여준다. */
export default async function RunPage({ params, searchParams }: Props) {
  await connection();
  const { runId } = await params;
  const load = await loadRun(reviewDataDir(), runId);
  if (!load.ok && load.reason === 'not-found') notFound();

  if (!load.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Run {runId}</h1>
        <RunProblemAlert problem={load} />
        <Link href="/" className={cn('text-sm underline underline-offset-4', focusRing)}>
          Back to runs
        </Link>
      </div>
    );
  }

  const { run } = load;
  const { change: requested } = await searchParams;
  const selected =
    run.changes.find((change) => change.id === requested) ?? firstToReview(run.changes);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          href="/"
          className={cn(
            'text-sm text-muted-foreground underline-offset-4 hover:underline',
            focusRing,
          )}
        >
          ← All runs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Run {run.id}</h1>
          <StatusBadge display={RUN_STATUS_DISPLAY[run.status]} />
        </div>
        <RunSummary run={run} />
      </div>
      <Separator />
      <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <ChangeList run={run} selectedId={selected.id} />
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>
                <h2 className="text-lg">{selected.label}</h2>
              </CardTitle>
              <StatusBadge display={CHANGE_STATUS_DISPLAY[selected.status]} />
            </div>
            <DefinitionList
              className="sm:grid-cols-3"
              fields={[
                { term: 'Mismatched pixels', value: formatPixels(selected.mismatchPixels) },
                { term: 'Mismatch ratio', value: formatRatio(selected.mismatchRatio) },
                { term: 'Story path', value: selected.targetPath, mono: true },
              ]}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            {selected.status === 'error' && (
              <Alert variant="destructive">
                <CircleX aria-hidden="true" />
                <AlertTitle>Comparison error</AlertTitle>
                <AlertDescription>{selected.error}</AlertDescription>
              </Alert>
            )}
            <ChangeViewer runId={run.id} change={selected} viewport={run.viewport} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
