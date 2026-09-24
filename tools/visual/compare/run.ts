import { rename, writeFile } from 'node:fs/promises';

import {
  deriveRunStatus,
  type VisualChange,
  type VisualRun,
  VisualRunSchema,
  type VisualTargetManifest,
} from '@review-platform/visual-contracts';

import { resolveInside } from '../paths.ts';
import { compareTarget } from './compare-target.ts';

export type RunMetadata = Pick<
  VisualRun,
  'id' | 'repository' | 'baseSha' | 'headSha' | 'createdAt'
>;

/** manifest의 target을 순서대로 비교해 run을 조립한다. status는 contract helper로만 계산한다. */
export async function compareRun(
  runRoot: string,
  manifest: VisualTargetManifest,
  metadata: RunMetadata,
): Promise<VisualRun> {
  const changes: VisualChange[] = [];
  for (const target of manifest.targets) changes.push(await compareTarget(runRoot, target));
  return {
    schemaVersion: 1,
    ...metadata,
    browser: 'chromium',
    viewport: manifest.viewport,
    status: deriveRunStatus(changes),
    changes,
  };
}

/** run을 schema로 다시 검증한 뒤 `<run>/run.json`을 쓴다. 임시 파일에 쓰고 rename해서 미완성 파일을 남기지 않는다. */
export async function writeRunJson(runRoot: string, run: VisualRun): Promise<string> {
  const path = resolveInside(runRoot, 'run.json');
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(VisualRunSchema.parse(run), null, 2)}\n`);
  await rename(tempPath, path);
  return path;
}
