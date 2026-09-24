import { describe, expect, it } from 'vitest';

import { parseCaptureArgs } from './args.ts';

const valid = [
  '--run-id',
  'sample',
  '--kind',
  'baseline',
  '--base-url',
  'http://127.0.0.1:6006',
  '--targets',
  'fixtures/visual/targets/sample.json',
];

const withOption = (name: string, value: string) => {
  const args = [...valid];
  args[args.indexOf(name) + 1] = value;
  return args;
};

describe('parseCaptureArgs', () => {
  it('parses all options, with or without the leading "--" pnpm forwards', () => {
    const expected = {
      runId: 'sample',
      kind: 'baseline',
      baseUrl: new URL('http://127.0.0.1:6006/'),
      targetsPath: 'fixtures/visual/targets/sample.json',
      dataDir: '.review-data',
    };
    expect(parseCaptureArgs(valid)).toEqual(expected);
    expect(parseCaptureArgs(['--', ...valid])).toEqual(expected);
  });

  it('accepts a custom --data-dir', () => {
    expect(parseCaptureArgs([...valid, '--data-dir', 'fixtures/visual/review-data'])?.dataDir).toBe(
      'fixtures/visual/review-data',
    );
  });

  it('returns null for --help', () => {
    expect(parseCaptureArgs(['--', '--help'])).toBeNull();
  });

  it.each(['baseline', 'current'])('accepts kind %j', (kind) => {
    expect(parseCaptureArgs(withOption('--kind', kind))?.kind).toBe(kind);
  });

  it.each(['diff', 'Baseline', ''])('rejects kind %j', (kind) => {
    expect(() => parseCaptureArgs(withOption('--kind', kind))).toThrow(/--kind/);
  });

  it.each(['../escape', 'a/b', '..', 'Sample', '/tmp/run'])('rejects run id %j', (runId) => {
    expect(() => parseCaptureArgs(withOption('--run-id', runId))).toThrow(/--run-id/);
  });

  it.each(['file:///tmp/sb', 'ftp://host', 'http://host/?path=a', 'not a url'])(
    'rejects base url %j',
    (baseUrl) => {
      expect(() => parseCaptureArgs(withOption('--base-url', baseUrl))).toThrow();
    },
  );

  it('rejects a missing option', () => {
    expect(() => parseCaptureArgs(valid.slice(2))).toThrow('Missing --run-id');
  });

  it('rejects an unknown option', () => {
    expect(() => parseCaptureArgs([...valid, '--full-page'])).toThrow();
  });
});
