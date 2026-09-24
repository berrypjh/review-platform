import type { VisualChange } from '@review-platform/visual-contracts';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPixels } from '@/lib/format';

import { ArtifactImage } from './artifact-image';

type ChangeViewerProps = {
  runId: string;
  change: VisualChange;
  viewport: { width: number; height: number };
};

/** diffPath가 null인 change는 contract상 unchanged 또는 error뿐이다. changed는 diff가 항상 있다. */
const NO_DIFF_REASON: Record<Exclude<VisualChange['status'], 'changed'>, string> = {
  unchanged: 'No diff generated because baseline and current are identical.',
  error: 'No diff generated because the comparison did not run.',
};

const noDiffReason = (change: VisualChange) =>
  change.status === 'changed' ? '' : NO_DIFF_REASON[change.status];

/** Baseline / Current / Diff 탭과, 넓은 화면에서 좌우로 놓이는 baseline·current 비교 영역. */
export function ChangeViewer({ runId, change, viewport }: ChangeViewerProps) {
  const image = (kind: 'baseline' | 'current', path: string | null) => (
    <ArtifactImage
      runId={runId}
      path={path}
      viewport={viewport}
      caption={kind === 'baseline' ? 'Baseline' : 'Current'}
      alt={`${change.label}: ${kind} screenshot`}
      missingText={`No ${kind} image was captured.`}
    />
  );

  return (
    <div className="space-y-8">
      {/* change가 바뀌면 key로 Tabs를 다시 만들어 선택 탭을 초기화한다. */}
      <Tabs key={change.id} defaultValue={change.diffPath ? 'diff' : 'current'}>
        <div className="flex flex-wrap items-center gap-3">
          <TabsList aria-label="Screenshot">
            <TabsTrigger value="baseline">Baseline</TabsTrigger>
            <TabsTrigger value="current">Current</TabsTrigger>
            <TabsTrigger value="diff" disabled={!change.diffPath}>
              Diff
            </TabsTrigger>
          </TabsList>
          {!change.diffPath && (
            <p className="text-sm text-muted-foreground">{noDiffReason(change)}</p>
          )}
        </div>
        <TabsContent value="baseline" className="mt-4">
          {image('baseline', change.baselinePath)}
        </TabsContent>
        <TabsContent value="current" className="mt-4">
          {image('current', change.currentPath)}
        </TabsContent>
        <TabsContent value="diff" className="mt-4">
          <ArtifactImage
            runId={runId}
            path={change.diffPath}
            viewport={viewport}
            caption="Diff"
            alt={`${change.label}: diff with ${formatPixels(change.mismatchPixels)} highlighted in red`}
            missingText={noDiffReason(change)}
          />
        </TabsContent>
      </Tabs>

      <section aria-labelledby="side-by-side-heading" className="space-y-4">
        <h3 id="side-by-side-heading" className="text-base font-semibold">
          Baseline and current side by side
        </h3>
        <div className="grid gap-6 lg:grid-cols-2">
          {image('baseline', change.baselinePath)}
          {image('current', change.currentPath)}
        </div>
      </section>
    </div>
  );
}
