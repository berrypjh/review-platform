import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { readManifest } from '../manifest.ts';
import { resolveInside, runDir } from '../paths.ts';
import { parseCaptureArgs, USAGE } from './args.ts';
import { captureTargets } from './capture.ts';

/** `pnpm visual:capture`: manifest의 story를 찍어 `<data-dir>/runs/<run-id>/<kind>/`에 PNG로 저장한다. */
async function main(argv: string[]): Promise<void> {
  const args = parseCaptureArgs(argv);
  if (!args) {
    console.log(USAGE);
    return;
  }
  const manifest = await readManifest(args.targetsPath);
  const cwd = process.cwd();
  const runRoot = runDir(resolve(cwd, args.dataDir), args.runId);
  const outDir = resolveInside(runRoot, args.kind);
  // 같은 run의 같은 kind를 덮어쓰면 이전 결과와 섞이므로 새 run-id를 요구한다.
  if (existsSync(outDir)) {
    throw new Error(`${relative(cwd, outDir)} already exists; use a new --run-id`);
  }
  await mkdir(outDir, { recursive: true });

  const files = await captureTargets(manifest, args.baseUrl, runRoot, args.kind);
  for (const file of files) console.log(`captured ${relative(cwd, file)}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
