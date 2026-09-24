import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VisualTargetManifestSchema } from './target-manifest.ts';

const fixturePath = resolve(import.meta.dirname, '../../../../fixtures/visual/targets/sample.json');
const sample = JSON.parse(readFileSync(fixturePath, 'utf8'));

const withTarget = (target: Record<string, unknown>) => ({
  ...sample,
  targets: [{ ...sample.targets[0], ...target }],
});

describe('VisualTargetManifestSchema', () => {
  it('accepts the sample fixture', () => {
    expect(VisualTargetManifestSchema.safeParse(sample).success).toBe(true);
  });

  it.each([
    'Button--Primary',
    'button/primary',
    '../button',
    '-button',
    'button-',
    'button primary',
    '',
  ])('rejects target id %j', (id) => {
    expect(VisualTargetManifestSchema.safeParse(withTarget({ id })).success).toBe(false);
  });

  it.each([
    { width: 0, height: 800 },
    { width: 1280, height: -1 },
    { width: 1280.5, height: 800 },
    { width: '1280', height: 800 },
  ])('rejects viewport %j', (viewport) => {
    expect(VisualTargetManifestSchema.safeParse({ ...sample, viewport }).success).toBe(false);
  });

  it.each([
    'https://example.com/iframe.html',
    '//example.com/iframe.html',
    'javascript:alert(1)',
    '/iframe.html',
    '../iframe.html',
    'stories/../iframe.html',
    'iframe.html?id=a b',
    'stories\\iframe.html',
    'iframe.html\u0007',
  ])('rejects target path %j', (path) => {
    expect(VisualTargetManifestSchema.safeParse(withTarget({ path })).success).toBe(false);
  });

  it('rejects an empty target list', () => {
    expect(VisualTargetManifestSchema.safeParse({ ...sample, targets: [] }).success).toBe(false);
  });

  it('rejects duplicate target ids', () => {
    const targets = [sample.targets[0], { ...sample.targets[1], id: sample.targets[0].id }];
    expect(VisualTargetManifestSchema.safeParse({ ...sample, targets }).success).toBe(false);
  });
});
