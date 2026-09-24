import { describe, expect, it } from 'vitest';

import {
  deriveRunStatus,
  type VisualChange,
  VisualChangeSchema,
  VisualRunSchema,
} from './visual-run.ts';

const unchanged = {
  id: 'button--primary',
  label: 'Button / Primary',
  targetPath: 'iframe.html?id=button--primary',
  status: 'unchanged',
  baselinePath: 'baseline/button--primary.png',
  currentPath: 'current/button--primary.png',
  diffPath: null,
  mismatchPixels: 0,
  mismatchRatio: 0,
  error: null,
} satisfies VisualChange;

const changed = {
  ...unchanged,
  id: 'card--default',
  status: 'changed',
  diffPath: 'diff/card--default.png',
  mismatchPixels: 120,
  mismatchRatio: 0.0012,
} satisfies VisualChange;

const errored = {
  ...unchanged,
  id: 'badge--default',
  status: 'error',
  currentPath: null,
  mismatchPixels: null,
  mismatchRatio: null,
  error: 'Timed out waiting for the story to render',
} satisfies VisualChange;

const run = {
  schemaVersion: 1,
  id: 'run-20260924-1',
  repository: 'example/design-system',
  baseSha: 'a1b2c3d',
  headSha: 'e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
  createdAt: '2026-09-24T12:00:00.000Z',
  browser: 'chromium',
  viewport: { width: 1280, height: 800 },
  status: 'passed',
  changes: [unchanged],
};

const isValidChange = (change: Record<string, unknown>) =>
  VisualChangeSchema.safeParse(change).success;

describe('VisualChangeSchema', () => {
  it('accepts one valid change per status', () => {
    expect([unchanged, changed, errored].map(isValidChange)).toEqual([true, true, true]);
  });

  it.each([
    ['non-zero mismatchPixels', { mismatchPixels: 1 }],
    ['non-zero mismatchRatio', { mismatchRatio: 0.1 }],
    ['missing baseline', { baselinePath: null }],
    ['missing current', { currentPath: null }],
    ['an error message', { error: 'boom' }],
  ])('rejects unchanged with %s', (_, patch) => {
    expect(isValidChange({ ...unchanged, ...patch })).toBe(false);
  });

  it.each([
    ['zero mismatchPixels', { mismatchPixels: 0 }],
    ['zero mismatchRatio', { mismatchRatio: 0 }],
    ['mismatchRatio above 1', { mismatchRatio: 1.5 }],
    ['missing diff', { diffPath: null }],
    ['missing baseline', { baselinePath: null }],
    ['an error message', { error: 'boom' }],
  ])('rejects changed with %s', (_, patch) => {
    expect(isValidChange({ ...changed, ...patch })).toBe(false);
  });

  it.each([
    ['a null error', { error: null }],
    ['an empty error', { error: '' }],
    ['mismatchPixels reported as 0', { mismatchPixels: 0 }],
    ['mismatchRatio reported as 0', { mismatchRatio: 0 }],
  ])('rejects error with %s', (_, patch) => {
    expect(isValidChange({ ...errored, ...patch })).toBe(false);
  });

  it.each([
    '/tmp/current.png',
    '../current.png',
    'current\\a.png',
    'current/a.jpg',
    'C:/current.png',
  ])('rejects artifact path %j', (currentPath) => {
    expect(isValidChange({ ...unchanged, currentPath })).toBe(false);
  });
});

describe('deriveRunStatus', () => {
  it('returns passed when every change is unchanged', () => {
    expect(deriveRunStatus([unchanged, unchanged])).toBe('passed');
  });

  it('returns review-required when something changed and nothing errored', () => {
    expect(deriveRunStatus([unchanged, changed])).toBe('review-required');
  });

  it('returns failed when any change errored, even alongside changes', () => {
    expect(deriveRunStatus([changed, errored, unchanged])).toBe('failed');
  });

  it('throws on zero changes instead of reporting passed', () => {
    expect(() => deriveRunStatus([])).toThrow();
  });
});

describe('VisualRunSchema', () => {
  it('accepts a run whose status matches its changes', () => {
    expect(VisualRunSchema.safeParse(run).success).toBe(true);
    expect(
      VisualRunSchema.safeParse({
        ...run,
        status: 'failed',
        changes: [unchanged, changed, errored],
      }).success,
    ).toBe(true);
  });

  it('rejects a status that disagrees with the changes', () => {
    expect(
      VisualRunSchema.safeParse({ ...run, status: 'passed', changes: [changed] }).success,
    ).toBe(false);
  });

  it('rejects a run with no changes', () => {
    expect(VisualRunSchema.safeParse({ ...run, changes: [] }).success).toBe(false);
  });

  it('rejects duplicate change ids', () => {
    expect(VisualRunSchema.safeParse({ ...run, changes: [unchanged, unchanged] }).success).toBe(
      false,
    );
  });

  it.each(['', 'abc12', 'A1B2C3D', 'g1b2c3d', 'a1b2c3d ', 'a'.repeat(65)])(
    'rejects malformed SHA %j',
    (baseSha) => {
      expect(VisualRunSchema.safeParse({ ...run, baseSha }).success).toBe(false);
    },
  );

  it.each(['2026-09-24', '2026-09-24T21:00:00+09:00', '2026-13-40T00:00:00Z', 'yesterday', ''])(
    'rejects createdAt %j (UTC "Z" timestamps only)',
    (createdAt) => {
      expect(VisualRunSchema.safeParse({ ...run, createdAt }).success).toBe(false);
    },
  );

  it('rejects a browser other than chromium', () => {
    expect(VisualRunSchema.safeParse({ ...run, browser: 'firefox' }).success).toBe(false);
  });
});
