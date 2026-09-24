import type { VisualChange, VisualRun, VisualRunStatus } from '@review-platform/visual-contracts';

export const FAIL_ON_LEVELS = ['review-required', 'failed'] as const;
export type FailOn = (typeof FAIL_ON_LEVELS)[number];

/** 심각도 순서. `--fail-on`은 이 순서에서 자기 이상인 status를 실패로 본다. */
const SEVERITY: Record<VisualRunStatus, number> = { passed: 0, 'review-required': 1, failed: 2 };

export const shouldFail = (status: VisualRunStatus, failOn: FailOn) =>
  SEVERITY[status] >= SEVERITY[failOn];

const percent = (ratio: number) => `${(ratio * 100).toFixed(4)}%`;

/** change 한 줄의 mismatch 칸. 측정하지 않은 값은 숫자 대신 오류 메시지를 쓴다. */
function mismatchCell(change: VisualChange): string {
  if (change.status === 'error') return change.error;
  return `${change.mismatchPixels.toLocaleString('en-US')} px (${percent(change.mismatchRatio)})`;
}

/** GitHub step summary와 PR 코멘트에 붙일 Markdown. 이미지는 artifact에만 있으므로 표만 만든다. */
export function renderSummary(run: VisualRun): string {
  const rows = run.changes.map(
    (change) => `| ${change.label} | ${change.status} | ${mismatchCell(change)} |`,
  );
  return [
    `## Visual regression: ${run.status}`,
    '',
    `\`${run.repository}\` · base \`${run.baseSha.slice(0, 7)}\` → head \`${run.headSha.slice(0, 7)}\` · Chromium ${run.viewport.width}×${run.viewport.height} · run \`${run.id}\``,
    '',
    '| Target | Status | Mismatch |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
