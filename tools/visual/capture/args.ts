import { parseArgs } from 'node:util';

import {
  COMMON_OPTIONS,
  COMMON_USAGE,
  parseRunId,
  required,
  stripLeadingDashes,
} from '../cli-args.ts';
import { parseBaseUrl } from './url.ts';

export const CAPTURE_KINDS = ['baseline', 'current'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export type CaptureArgs = {
  runId: string;
  kind: CaptureKind;
  baseUrl: URL;
  targetsPath: string;
  dataDir: string;
};

export const USAGE = `Usage: pnpm visual:capture -- --run-id <id> --kind <baseline|current> --base-url <url> --targets <file>

Captures one viewport PNG per target to <data-dir>/runs/<run-id>/<kind>/<target-id>.png

Options:
  --kind      baseline | current
  --base-url  Storybook base URL, e.g. http://127.0.0.1:6006
${COMMON_USAGE}`;

const isCaptureKind = (value: string): value is CaptureKind =>
  (CAPTURE_KINDS as readonly string[]).includes(value);

/** capture CLI 인자를 파싱한다. --help면 null을 돌려주고, 값이 없거나 잘못되면 예외를 던진다. */
export function parseCaptureArgs(argv: string[]): CaptureArgs | null {
  const { values } = parseArgs({
    args: stripLeadingDashes(argv),
    options: {
      ...COMMON_OPTIONS,
      kind: { type: 'string' },
      'base-url': { type: 'string' },
    },
  });
  if (values.help) return null;

  const kind = required(values.kind, '--kind');
  if (!isCaptureKind(kind)) {
    throw new Error(`Invalid --kind "${kind}": expected ${CAPTURE_KINDS.join(' or ')}`);
  }
  return {
    runId: parseRunId(values['run-id']),
    kind,
    baseUrl: parseBaseUrl(required(values['base-url'], '--base-url')),
    targetsPath: required(values.targets, '--targets'),
    dataDir: values['data-dir'],
  };
}
