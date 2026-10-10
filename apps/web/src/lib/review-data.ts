import { existsSync } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  ArtifactPathSchema,
  SafeIdSchema,
  type VisualRun,
  VisualRunSchema,
} from '@review-platform/visual-contracts';

/**
 * run을 보여주지 못하는 이유. 화면은 reason별로 다른 안내를 낸다.
 * production에서는 Server Component가 던진 예외의 message가 브라우저에 전달되지 않으므로
 * 예외 대신 값으로 돌려준다.
 */
export type RunProblem = {
  runId: string;
  reason: 'not-found' | 'not-compared' | 'invalid-contract' | 'filesystem';
  detail: string;
};

export type RunLoad = { ok: true; run: VisualRun } | ({ ok: false } & RunProblem);

export type RunListing = { runs: VisualRun[]; problems: RunProblem[] };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const isMissing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '');
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `next dev`는 apps/web에서 실행되므로 cwd가 아니라 pnpm-workspace.yaml이 있는 곳을 기준으로 삼는다. */
function findWorkspaceRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml found above ${start}`);
    dir = parent;
  }
  return dir;
}

/** REVIEW_DATA_DIR를 해석한다. 상대 경로는 workspace root 기준, 절대 경로는 그대로. 기본값은 `<workspace>/.review-data`다. */
export function reviewDataDir(): string {
  const configured = process.env['REVIEW_DATA_DIR'] || '.review-data';
  // 절대 경로는 workspace root를 찾지 않는다. 서버리스 번들처럼 pnpm-workspace.yaml이 없는 곳에서도 쓸 수 있다.
  // 데이터는 실행 중에만 읽는다. 번들 tracing 대상에서 뺀다.
  if (isAbsolute(configured)) return resolve(/*turbopackIgnore: true*/ configured);
  return resolve(/*turbopackIgnore: true*/ findWorkspaceRoot(process.cwd()), configured);
}

/** `<dataDir>/runs/<runId>/run.json`을 읽어 VisualRun contract로 검증한다. */
export async function loadRun(dataDir: string, runId: string): Promise<RunLoad> {
  const fail = (reason: RunProblem['reason'], detail: string): RunLoad => ({
    ok: false,
    runId,
    reason,
    detail,
  });
  if (!SafeIdSchema.safeParse(runId).success) {
    return fail('not-found', 'Not a valid run id (a-z, 0-9 and "-").');
  }
  const runRoot = join(dataDir, 'runs', runId);
  if (!existsSync(runRoot)) return fail('not-found', 'Run directory does not exist.');

  let text: string;
  try {
    text = await readFile(join(runRoot, 'run.json'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return fail('not-compared', 'run.json has not been written yet.');
    return fail('filesystem', messageOf(error));
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('invalid-contract', 'run.json is not valid JSON.');
  }
  const result = VisualRunSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    return fail('invalid-contract', issues.join('; '));
  }
  if (result.data.id !== runId) {
    return fail('invalid-contract', `run.id "${result.data.id}" does not match its directory.`);
  }
  return { ok: true, run: result.data };
}

/** 모든 run 디렉터리를 읽어 `createdAt` 최신순으로 돌려준다. runs 디렉터리가 없으면 run이 없는 것으로 본다. */
export async function listRuns(dataDir: string): Promise<RunListing> {
  let entries;
  try {
    entries = await readdir(join(dataDir, 'runs'), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { runs: [], problems: [] };
    throw error;
  }
  const loads = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => loadRun(dataDir, entry.name)),
  );
  const runs: VisualRun[] = [];
  const problems: RunProblem[] = [];
  for (const load of loads) {
    if (load.ok) runs.push(load.run);
    else problems.push({ runId: load.runId, reason: load.reason, detail: load.detail });
  }
  runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { runs, problems };
}

/**
 * run artifact PNG의 바이트를 돌려준다. 다음 중 하나라도 어긋나면 null이다.
 * run id와 경로가 contract 규칙에 맞고, symlink를 따라간 실제 위치가 데이터 디렉터리 안이며, PNG signature로 시작해야 한다.
 */
export async function readArtifactPng(
  dataDir: string,
  runId: string,
  segments: string[],
): Promise<Uint8Array<ArrayBuffer> | null> {
  const artifactPath = segments.join('/');
  if (!SafeIdSchema.safeParse(runId).success) return null;
  if (!ArtifactPathSchema.safeParse(artifactPath).success) return null;
  try {
    const [realRoot, realFile] = await Promise.all([
      realpath(dataDir),
      realpath(join(dataDir, 'runs', runId, artifactPath)),
    ]);
    const rel = relative(realRoot, realFile);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    const bytes = await readFile(realFile);
    return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte) ? new Uint8Array(bytes) : null;
  } catch (error) {
    if (isMissing(error) || errorCode(error) === 'EISDIR') return null;
    throw error;
  }
}
