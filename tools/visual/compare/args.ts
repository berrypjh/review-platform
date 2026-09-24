import { parseArgs } from 'node:util';

import { GitShaSchema } from '@review-platform/visual-contracts';

import {
  COMMON_OPTIONS,
  COMMON_USAGE,
  parseRunId,
  required,
  stripLeadingDashes,
} from '../cli-args.ts';

export type CompareArgs = {
  runId: string;
  repository: string;
  baseSha: string;
  headSha: string;
  targetsPath: string;
  dataDir: string;
};

export const USAGE = `Usage: pnpm visual:compare -- --run-id <id> --repository <name> --base-sha <sha> --head-sha <sha> --targets <file>

Compares <data-dir>/runs/<run-id>/{baseline,current}/<target-id>.png, writes diff/<target-id>.png
for changed targets and <data-dir>/runs/<run-id>/run.json.

Options:
  --repository  Repository name recorded in run.json, e.g. berrypjh/shared-stack
  --base-sha    Base commit SHA: 7-64 lowercase hex chars
  --head-sha    Head commit SHA: 7-64 lowercase hex chars
${COMMON_USAGE}`;

function sha(value: string | undefined, name: string): string {
  const sha = required(value, name);
  if (!GitShaSchema.safeParse(sha).success) {
    throw new Error(`Invalid ${name} "${sha}": use 7-64 lowercase hex chars`);
  }
  return sha;
}

/** compare CLI 인자를 파싱한다. --help면 null을 돌려주고, 값이 없거나 잘못되면 예외를 던진다. */
export function parseCompareArgs(argv: string[]): CompareArgs | null {
  const { values } = parseArgs({
    args: stripLeadingDashes(argv),
    options: {
      ...COMMON_OPTIONS,
      repository: { type: 'string' },
      'base-sha': { type: 'string' },
      'head-sha': { type: 'string' },
    },
  });
  if (values.help) return null;

  return {
    runId: parseRunId(values['run-id']),
    repository: required(values.repository, '--repository'),
    baseSha: sha(values['base-sha'], '--base-sha'),
    headSha: sha(values['head-sha'], '--head-sha'),
    targetsPath: required(values.targets, '--targets'),
    dataDir: values['data-dir'],
  };
}
