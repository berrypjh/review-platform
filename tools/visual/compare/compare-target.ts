import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { VisualChange, VisualTarget } from '@review-platform/visual-contracts';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { artifactPath, resolveArtifact } from '../paths.ts';

/** PNG를 읽는다. 파일이 없으면 null이고, 그 밖의 읽기·디코딩 오류는 그대로 던진다. */
async function readPng(path: string): Promise<PNG | null> {
  try {
    return PNG.sync.read(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * target 하나의 baseline과 current PNG를 픽셀 단위로 정확히 비교한다
 * (pixelmatch threshold 0, anti-aliasing 제외 없음). 다른 픽셀이 있을 때만 diff PNG를 쓴다.
 * 이미지가 없거나 크기가 다르면 `error` change가 되고, 이 경우 아무것도 측정하지 않는다.
 */
export async function compareTarget(runRoot: string, target: VisualTarget): Promise<VisualChange> {
  const base = { id: target.id, label: target.label, targetPath: target.path };
  const baselinePath = artifactPath('baseline', target.id);
  const currentPath = artifactPath('current', target.id);
  const [baseline, current] = await Promise.all([
    readPng(resolveArtifact(runRoot, baselinePath)),
    readPng(resolveArtifact(runRoot, currentPath)),
  ]);

  const errorChange = (message: string): VisualChange => ({
    ...base,
    status: 'error',
    baselinePath: baseline ? baselinePath : null,
    currentPath: current ? currentPath : null,
    diffPath: null,
    mismatchPixels: null,
    mismatchRatio: null,
    error: message,
  });

  if (!baseline || !current) {
    const missing = [baseline ? null : baselinePath, current ? null : currentPath];
    return errorChange(`Missing image: ${missing.filter(Boolean).join(', ')}`);
  }
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return errorChange(
      `Dimension mismatch: baseline ${baseline.width}x${baseline.height}, current ${current.width}x${current.height}`,
    );
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold: 0,
    includeAA: true,
  });
  if (mismatchPixels === 0) {
    return {
      ...base,
      status: 'unchanged',
      baselinePath,
      currentPath,
      diffPath: null,
      mismatchPixels: 0,
      mismatchRatio: 0,
      error: null,
    };
  }

  const diffPath = artifactPath('diff', target.id);
  const diffFile = resolveArtifact(runRoot, diffPath);
  await mkdir(dirname(diffFile), { recursive: true });
  await writeFile(diffFile, PNG.sync.write(diff));
  return {
    ...base,
    status: 'changed',
    baselinePath,
    currentPath,
    diffPath,
    mismatchPixels,
    mismatchRatio: mismatchPixels / (width * height),
    error: null,
  };
}
