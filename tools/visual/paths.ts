import { isAbsolute, relative, resolve, sep } from 'node:path';

export const DEFAULT_DATA_DIR = '.review-data';

export type ArtifactKind = 'baseline' | 'current' | 'diff';

/** root 아래로 segments를 해석한다. 결과가 root 자신이거나 root 밖이면 예외를 던진다. */
export function resolveInside(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path "${segments.join('/')}" escapes ${root}`);
  }
  return target;
}

/** run 디렉터리: `<dataDir>/runs/<run-id>`. */
export function runDir(dataDir: string, runId: string): string {
  return resolveInside(resolve(dataDir, 'runs'), runId);
}

/** run.json에 기록하는 run 기준 상대 경로. 예: `diff/button--primary.png`. */
export function artifactPath(kind: ArtifactKind, targetId: string): string {
  return `${kind}/${targetId}.png`;
}

/** run 기준 상대 경로를 절대 경로로 바꾼다. run 밖을 가리키면 예외를 던진다. */
export function resolveArtifact(runRoot: string, relativePath: string): string {
  return resolveInside(runRoot, relativePath);
}
