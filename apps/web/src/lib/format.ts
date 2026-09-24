import type { VisualChange, VisualChangeStatus } from '@review-platform/visual-contracts';

/** 측정하지 않은 값(null)의 표시. 0으로 보이면 안 된다. */
const NOT_MEASURED = 'Not measured';

export const shortSha = (sha: string) => sha.slice(0, 7);

/** `2026-09-24T12:25:19.914Z` -> `2026-09-24 12:25 UTC`. createdAt은 contract상 항상 UTC다. */
export const formatTimestamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export const formatRunCount = (count: number) => `${count} ${count === 1 ? 'run' : 'runs'}`;

export const formatPixels = (pixels: number | null) =>
  pixels === null ? NOT_MEASURED : `${pixels.toLocaleString('en-US')} px`;

/** 소수 둘째 자리 백분율. 아주 작은 양수 비율이 반올림되어 0%처럼 보이지 않게 `<0.01%`로 표시한다. */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return NOT_MEASURED;
  if (ratio === 0) return '0%';
  const percent = ratio * 100;
  return percent < 0.01 ? '<0.01%' : `${percent.toFixed(2)}%`;
}

export function countChanges(changes: VisualChange[]): Record<VisualChangeStatus, number> {
  const counts = { unchanged: 0, changed: 0, error: 0 };
  for (const change of changes) counts[change.status] += 1;
  return counts;
}
