import { SafeIdSchema } from '@review-platform/visual-contracts';

import { DEFAULT_DATA_DIR } from './paths.ts';

/** `pnpm <script> -- ...`가 script에 그대로 넘기는 맨 앞의 "--"를 떼어 낸다. */
export function stripLeadingDashes(argv: string[]): string[] {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** run id는 디렉터리 이름이 되므로 contract의 SafeId 규칙을 그대로 따른다. */
export function parseRunId(value: string | undefined): string {
  const runId = required(value, '--run-id');
  if (!SafeIdSchema.safeParse(runId).success) {
    throw new Error(`Invalid --run-id "${runId}": use a-z, 0-9 and "-"`);
  }
  return runId;
}

/** capture와 compare가 공통으로 받는 옵션. `util.parseArgs`의 options에 펼쳐 넣는다. */
export const COMMON_OPTIONS = {
  'run-id': { type: 'string' },
  targets: { type: 'string' },
  'data-dir': { type: 'string', default: DEFAULT_DATA_DIR },
  help: { type: 'boolean' },
} as const;

export const COMMON_USAGE = `  --run-id    Run directory name: a-z, 0-9 and "-"
  --targets   VisualTargetManifest JSON file
  --data-dir  Review data directory (default: ${DEFAULT_DATA_DIR})
  --help      Show this message`;
