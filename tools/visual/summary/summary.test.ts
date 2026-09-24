import type { VisualRun } from '@review-platform/visual-contracts';
import { describe, expect, it } from 'vitest';

import { renderSummary, shouldFail } from './summary.ts';

const run: VisualRun = {
  schemaVersion: 1,
  id: 'pr-12',
  repository: 'berrypjh/shared-stack',
  baseSha: '7888724e59b35e45880c736f03b4ecf3215f8e78',
  headSha: '1b23f79886418f93b85d6e6fedf3f134bcb93c39',
  createdAt: '2026-09-24T13:04:00.000Z',
  browser: 'chromium',
  viewport: { width: 1280, height: 720 },
  status: 'failed',
  changes: [
    {
      id: 'button--default',
      label: 'Button / Default',
      targetPath: 'iframe.html?id=button--default',
      status: 'unchanged',
      baselinePath: 'baseline/button--default.png',
      currentPath: 'current/button--default.png',
      diffPath: null,
      mismatchPixels: 0,
      mismatchRatio: 0,
      error: null,
    },
    {
      id: 'button--loading',
      label: 'Button / Loading',
      targetPath: 'iframe.html?id=button--loading',
      status: 'changed',
      baselinePath: 'baseline/button--loading.png',
      currentPath: 'current/button--loading.png',
      diffPath: 'diff/button--loading.png',
      mismatchPixels: 490,
      mismatchRatio: 490 / (1280 * 720),
      error: null,
    },
    {
      id: 'card--default',
      label: 'Card / Default',
      targetPath: 'iframe.html?id=card--default',
      status: 'error',
      baselinePath: 'baseline/card--default.png',
      currentPath: null,
      diffPath: null,
      mismatchPixels: null,
      mismatchRatio: null,
      error: 'Missing image: current/card--default.png',
    },
  ],
};

describe('renderSummary', () => {
  it('renders the run status, short SHAs and one row per change', () => {
    const summary = renderSummary(run);
    expect(summary).toContain('## Visual regression: failed');
    expect(summary).toContain('base `7888724` → head `1b23f79`');
    expect(summary).toContain('| Button / Default | unchanged | 0 px (0.0000%) |');
    expect(summary).toContain('| Button / Loading | changed | 490 px (0.0532%) |');
    expect(summary).toContain(
      '| Card / Default | error | Missing image: current/card--default.png |',
    );
  });
});

describe('shouldFail', () => {
  it('fails only on failed by default', () => {
    expect(shouldFail('passed', 'failed')).toBe(false);
    expect(shouldFail('review-required', 'failed')).toBe(false);
    expect(shouldFail('failed', 'failed')).toBe(true);
  });

  it('also fails on review-required when asked', () => {
    expect(shouldFail('passed', 'review-required')).toBe(false);
    expect(shouldFail('review-required', 'review-required')).toBe(true);
    expect(shouldFail('failed', 'review-required')).toBe(true);
  });
});
