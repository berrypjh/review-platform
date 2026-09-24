import { z } from 'zod';

import { RelativeTargetPathSchema, SafeIdSchema, ViewportSchema } from './primitives.ts';

/** capture 대상 story 하나. id는 산출물 파일 이름이 되고 path는 Storybook base URL 뒤에 붙는다. */
export const VisualTargetSchema = z.strictObject({
  id: SafeIdSchema,
  label: z.string().min(1),
  path: RelativeTargetPathSchema,
});

/** capture/compare 입력 manifest. viewport는 run 전체에 한 벌만 쓴다. */
export const VisualTargetManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repository: z.string().min(1),
    viewport: ViewportSchema,
    targets: z.array(VisualTargetSchema).min(1),
  })
  .refine(
    (manifest) =>
      new Set(manifest.targets.map((target) => target.id)).size === manifest.targets.length,
    { message: 'Target ids must be unique', path: ['targets'] },
  );

export type VisualTarget = z.infer<typeof VisualTargetSchema>;
export type VisualTargetManifest = z.infer<typeof VisualTargetManifestSchema>;
