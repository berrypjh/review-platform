import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { artifactPath, resolveArtifact, resolveInside, runDir } from './paths.ts';

const dataDir = '/workspace/.review-data';

describe('run paths', () => {
  it('puts a target PNG at <data-dir>/runs/<run-id>/<kind>/<target-id>.png', () => {
    const root = runDir(dataDir, 'sample');
    expect(artifactPath('baseline', 'button--primary')).toBe('baseline/button--primary.png');
    expect(resolveArtifact(root, artifactPath('baseline', 'button--primary'))).toBe(
      join(dataDir, 'runs/sample/baseline/button--primary.png'),
    );
  });

  it.each(['..', '../..', '../../etc', '/etc', ''])(
    'blocks run id %j from escaping the runs dir',
    (runId) => {
      expect(() => runDir(dataDir, runId)).toThrow(/escapes/);
    },
  );

  it.each(['../x', '../../x.png', '/tmp/x.png', ''])('resolveInside rejects %j', (segment) => {
    expect(() => resolveInside('/workspace/dir', segment)).toThrow(/escapes/);
  });
});
