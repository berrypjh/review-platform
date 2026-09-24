import { z } from 'zod';

import {
  ArtifactPathSchema,
  GitShaSchema,
  IsoDateTimeSchema,
  RelativeTargetPathSchema,
  SafeIdSchema,
  ViewportSchema,
} from './primitives.ts';

const changeBase = {
  id: SafeIdSchema,
  label: z.string().min(1),
  targetPath: RelativeTargetPathSchema,
};

/** baseline과 current가 완전히 같다. mismatch 값은 0이고 diff는 만들지 않아도 된다. */
const UnchangedSchema = z.strictObject({
  ...changeBase,
  status: z.literal('unchanged'),
  baselinePath: ArtifactPathSchema,
  currentPath: ArtifactPathSchema,
  diffPath: ArtifactPathSchema.nullable(),
  mismatchPixels: z.literal(0),
  mismatchRatio: z.literal(0),
  error: z.null(),
});

/** baseline과 current가 다르다. diff 이미지가 반드시 있고 mismatch 값은 양수다. */
const ChangedSchema = z.strictObject({
  ...changeBase,
  status: z.literal('changed'),
  baselinePath: ArtifactPathSchema,
  currentPath: ArtifactPathSchema,
  diffPath: ArtifactPathSchema,
  mismatchPixels: z.int().positive(),
  mismatchRatio: z.number().gt(0).lte(1),
  error: z.null(),
});

/** capture 또는 비교가 실패했다. 측정하지 않은 값은 0이 아니라 null로 둔다. */
const ErrorSchema = z.strictObject({
  ...changeBase,
  status: z.literal('error'),
  baselinePath: ArtifactPathSchema.nullable(),
  currentPath: ArtifactPathSchema.nullable(),
  diffPath: ArtifactPathSchema.nullable(),
  mismatchPixels: z.null(),
  mismatchRatio: z.null(),
  error: z.string().min(1),
});

/** status별 불변식을 union 구조 자체에 담아, 상태와 값이 어긋난 change를 만들 수 없게 한다. */
export const VisualChangeSchema = z.discriminatedUnion('status', [
  UnchangedSchema,
  ChangedSchema,
  ErrorSchema,
]);

export const VisualRunStatusSchema = z.enum(['passed', 'review-required', 'failed']);

export type VisualChange = z.infer<typeof VisualChangeSchema>;
export type VisualChangeStatus = VisualChange['status'];
export type VisualRunStatus = z.infer<typeof VisualRunStatusSchema>;

/**
 * change 목록에서 run status를 계산한다. error가 하나라도 있으면 failed,
 * 아니면 changed가 하나라도 있으면 review-required, 그 외에는 passed다.
 * 빈 목록은 예외를 던진다. 결과가 없는 run이 passed로 읽히면 안 되기 때문이다.
 */
export function deriveRunStatus(
  changes: ReadonlyArray<{ status: VisualChangeStatus }>,
): VisualRunStatus {
  if (changes.length === 0) throw new Error('Cannot derive a run status from zero changes');
  if (changes.some((change) => change.status === 'error')) return 'failed';
  if (changes.some((change) => change.status === 'changed')) return 'review-required';
  return 'passed';
}

/** compare가 쓰고 Review UI가 읽는 최종 artifact(run.json). 모든 경로는 run 디렉터리 기준 상대 경로다. */
export const VisualRunSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SafeIdSchema,
    repository: z.string().min(1),
    baseSha: GitShaSchema,
    headSha: GitShaSchema,
    createdAt: IsoDateTimeSchema,
    browser: z.literal('chromium'),
    viewport: ViewportSchema,
    status: VisualRunStatusSchema,
    changes: z.array(VisualChangeSchema).min(1),
  })
  .refine((run) => new Set(run.changes.map((change) => change.id)).size === run.changes.length, {
    message: 'Change ids must be unique',
    path: ['changes'],
  })
  // zod 4는 changes의 min(1)이 실패해도 이 refine을 실행하므로, 빈 배열에서 deriveRunStatus가 던지지 않게 먼저 거른다.
  .refine((run) => run.changes.length === 0 || run.status === deriveRunStatus(run.changes), {
    message: 'Status must match the status derived from changes',
    path: ['status'],
  });

export type VisualRun = z.infer<typeof VisualRunSchema>;
