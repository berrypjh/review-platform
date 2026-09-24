import { readFile } from 'node:fs/promises';

import {
  type VisualTargetManifest,
  VisualTargetManifestSchema,
} from '@review-platform/visual-contracts';

/** target manifest를 읽고 검증한다. 실패하면 schema issue를 모두 나열한 예외를 던진다. */
export async function readManifest(path: string): Promise<VisualTargetManifest> {
  const result = VisualTargetManifestSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid target manifest ${path}:\n${issues.join('\n')}`);
  }
  return result.data;
}
