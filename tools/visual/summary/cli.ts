import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { VisualRunSchema } from '@review-platform/visual-contracts';

import { COMMON_OPTIONS, COMMON_USAGE, parseRunId, stripLeadingDashes } from '../cli-args.ts';
import { resolveInside, runDir } from '../paths.ts';
import { FAIL_ON_LEVELS, type FailOn, renderSummary, shouldFail } from './summary.ts';

const USAGE = `Usage: pnpm visual:summary -- --run-id <id> [--fail-on failed|review-required]

Prints a Markdown summary of <data-dir>/runs/<run-id>/run.json to stdout.
Exits 1 when the run status is at or above --fail-on (default: failed).
When GITHUB_OUTPUT is set, also appends "status=<run status>" to it.

Options:
  --fail-on   failed | review-required
${COMMON_USAGE}`;

const isFailOn = (value: string): value is FailOn =>
  (FAIL_ON_LEVELS as readonly string[]).includes(value);

/** `pnpm visual:summary`: CI가 run.json을 사람이 읽을 요약으로 바꾸고 job 성패를 정하는 데 쓴다. */
async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: stripLeadingDashes(argv),
    options: { ...COMMON_OPTIONS, 'fail-on': { type: 'string', default: 'failed' } },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const failOn = values['fail-on'];
  if (!isFailOn(failOn)) {
    throw new Error(`Invalid --fail-on "${failOn}": expected ${FAIL_ON_LEVELS.join(' or ')}`);
  }
  const runRoot = runDir(resolve(process.cwd(), values['data-dir']), parseRunId(values['run-id']));
  const run = VisualRunSchema.parse(
    JSON.parse(await readFile(resolveInside(runRoot, 'run.json'), 'utf8')),
  );

  console.log(renderSummary(run));
  if (process.env['GITHUB_OUTPUT']) {
    await appendFile(process.env['GITHUB_OUTPUT'], `status=${run.status}\n`);
  }
  if (shouldFail(run.status, failOn)) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
