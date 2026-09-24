import type { VisualChange } from '@review-platform/visual-contracts';
import { describe, expect, it } from 'vitest';

import {
  countChanges,
  formatPixels,
  formatRatio,
  formatRunCount,
  formatTimestamp,
  shortSha,
} from './format';
import { CHANGE_STATUS_DISPLAY, RUN_STATUS_DISPLAY } from './status-display';

describe('format helpers', () => {
  it('formats run counts', () => {
    expect([0, 1, 2].map(formatRunCount)).toEqual(['0 runs', '1 run', '2 runs']);
  });

  it('shows "Not measured" instead of 0 for missing values', () => {
    expect(formatPixels(null)).toBe('Not measured');
    expect(formatRatio(null)).toBe('Not measured');
  });

  it('formats measured values without hiding tiny changes', () => {
    expect(formatPixels(12345)).toBe('12,345 px');
    expect(formatRatio(0)).toBe('0%');
    expect(formatRatio(0.0125)).toBe('1.25%');
    expect(formatRatio(1 / 1_024_000)).toBe('<0.01%');
  });

  it('formats SHAs and timestamps', () => {
    expect(shortSha('7888724e59b35e45880c736f03b4ecf3215f8e78')).toBe('7888724');
    expect(formatTimestamp('2026-09-24T12:25:19.914Z')).toBe('2026-09-24 12:25 UTC');
  });

  it('counts changes by status', () => {
    const statuses = ['changed', 'unchanged', 'changed', 'error'] as const;
    const changes = statuses.map((status) => ({ status }) as VisualChange);
    expect(countChanges(changes)).toEqual({ changed: 2, unchanged: 1, error: 1 });
  });
});

describe('status display', () => {
  it('gives every change status a distinct label and icon', () => {
    const displays = Object.values(CHANGE_STATUS_DISPLAY);
    expect(displays.map((d) => d.label)).toEqual(['Unchanged', 'Changed', 'Error']);
    expect(new Set(displays.map((d) => d.icon)).size).toBe(3);
  });

  it('gives every run status a distinct label and icon', () => {
    const displays = Object.values(RUN_STATUS_DISPLAY);
    expect(displays.map((d) => d.label)).toEqual(['Passed', 'Review required', 'Failed']);
    expect(new Set(displays.map((d) => d.icon)).size).toBe(3);
  });
});
