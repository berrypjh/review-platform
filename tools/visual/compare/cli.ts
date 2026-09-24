import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { readManifest } from '../manifest.ts';
import { resolveInside, runDir } from '../paths.ts';
import { parseCompareArgs, USAGE } from './args.ts';
import { compareRun, writeRunJson } from './run.ts';

/** `pnpm visual:compare`: baseline/current PNG를 비교해 diff PNG와 run.json을 만든다. */
async function main(argv: string[]): Promise<void> {
  const args = parseCompareArgs(argv);
  if (!args) {
    console.log(USAGE);
    return;
  }
  const manifest = await readManifest(args.targetsPath);
  const cwd = process.cwd();
  const runRoot = runDir(resolve(cwd, args.dataDir), args.runId);
  if (!existsSync(runRoot)) throw new Error(`Run directory not found: ${relative(cwd, runRoot)}`);
  // 이미 비교한 run은 다시 비교하지 않는다. 다시 하려면 run.json과 diff/를 직접 지워야 한다.
  for (const output of ['run.json', 'diff']) {
    const path = resolveInside(runRoot, output);
    if (existsSync(path))
      throw new Error(`${relative(cwd, path)} already exists; this run was compared`);
  }

  const run = await compareRun(runRoot, manifest, {
    id: args.runId,
    repository: args.repository,
    baseSha: args.baseSha,
    headSha: args.headSha,
    createdAt: new Date().toISOString(),
  });
  const runJson = await writeRunJson(runRoot, run);

  for (const change of run.changes) {
    const detail =
      change.status === 'error'
        ? change.error
        : `${change.mismatchPixels} px (${change.mismatchRatio})`;
    console.log(`${change.status.padEnd(9)} ${change.id}  ${detail}`);
  }
  // exit code는 "비교 결과를 만들었는가"만 뜻한다. run status가 failed여도 run.json을 썼으면 0이다.
  console.log(`run ${run.status}: ${relative(cwd, runJson)}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
