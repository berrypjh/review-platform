import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type VisualTargetManifest, VisualRunSchema } from '@review-platform/visual-contracts';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compareTarget } from './compare-target.ts';
import { compareRun, writeRunJson } from './run.ts';

type Rgba = [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLUE: Rgba = [37, 99, 235, 255];

/** 흰색으로 채운 width x height PNG를 만들고, 지정한 픽셀만 다른 색으로 칠해서 인코딩한다. */
function png(width: number, height: number, painted: Array<[number, number, Rgba]> = []): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) image.data.set(WHITE, i * 4);
  for (const [x, y, color] of painted) image.data.set(color, (y * width + x) * 4);
  return PNG.sync.write(image);
}

let runRoot: string;

beforeEach(async () => {
  runRoot = await mkdtemp(join(tmpdir(), 'visual-compare-'));
});

afterEach(async () => {
  await rm(runRoot, { recursive: true });
});

async function put(kind: 'baseline' | 'current', id: string, image: Buffer) {
  const path = join(runRoot, kind, `${id}.png`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, image);
}

const target = (id: string) => ({ id, label: id, path: `iframe.html?id=${id}` });

describe('compareTarget', () => {
  it('reports identical images as unchanged without a diff', async () => {
    await put('baseline', 'same', png(4, 3));
    await put('current', 'same', png(4, 3));

    const change = await compareTarget(runRoot, target('same'));

    expect(change).toMatchObject({
      status: 'unchanged',
      mismatchPixels: 0,
      mismatchRatio: 0,
      diffPath: null,
    });
    expect(existsSync(join(runRoot, 'diff'))).toBe(false);
  });

  it('reports a single changed pixel as changed and writes a diff PNG', async () => {
    await put('baseline', 'moved', png(4, 3));
    await put('current', 'moved', png(4, 3, [[2, 1, BLUE]]));

    const change = await compareTarget(runRoot, target('moved'));

    expect(change).toMatchObject({
      status: 'changed',
      mismatchPixels: 1,
      mismatchRatio: 1 / 12,
      diffPath: 'diff/moved.png',
      error: null,
    });
    const diff = PNG.sync.read(await readFile(join(runRoot, 'diff/moved.png')));
    expect([diff.width, diff.height]).toEqual([4, 3]);
  });

  it('reports a dimension mismatch as an error without measuring', async () => {
    await put('baseline', 'resized', png(4, 3));
    await put('current', 'resized', png(5, 3));

    const change = await compareTarget(runRoot, target('resized'));

    expect(change).toMatchObject({
      status: 'error',
      baselinePath: 'baseline/resized.png',
      currentPath: 'current/resized.png',
      diffPath: null,
      mismatchPixels: null,
      mismatchRatio: null,
      error: 'Dimension mismatch: baseline 4x3, current 5x3',
    });
  });

  it('reports a missing baseline as an error', async () => {
    await put('current', 'new', png(4, 3));

    const change = await compareTarget(runRoot, target('new'));

    expect(change).toMatchObject({
      status: 'error',
      baselinePath: null,
      currentPath: 'current/new.png',
      error: 'Missing image: baseline/new.png',
    });
  });

  it('reports a missing current as an error', async () => {
    await put('baseline', 'gone', png(4, 3));

    const change = await compareTarget(runRoot, target('gone'));

    expect(change).toMatchObject({
      status: 'error',
      baselinePath: 'baseline/gone.png',
      currentPath: null,
      error: 'Missing image: current/gone.png',
    });
  });
});

describe('compareRun', () => {
  const metadata = {
    id: 'sample',
    repository: 'example/design-system',
    baseSha: 'a1b2c3d',
    headSha: 'e4f5a6b',
    createdAt: '2026-09-24T12:00:00.000Z',
  };
  const manifest = (ids: string[]): VisualTargetManifest => ({
    schemaVersion: 1,
    repository: metadata.repository,
    viewport: { width: 4, height: 3 },
    targets: ids.map(target),
  });

  beforeEach(async () => {
    await put('baseline', 'same', png(4, 3));
    await put('current', 'same', png(4, 3));
    await put('baseline', 'moved', png(4, 3));
    await put('current', 'moved', png(4, 3, [[0, 0, BLUE]]));
    await put('baseline', 'gone', png(4, 3));
  });

  it('is passed when every target is unchanged', async () => {
    expect((await compareRun(runRoot, manifest(['same']), metadata)).status).toBe('passed');
  });

  it('is review-required when a target changed and none errored', async () => {
    const run = await compareRun(runRoot, manifest(['same', 'moved']), metadata);
    expect(run.status).toBe('review-required');
    expect(run.changes.map((change) => change.status)).toEqual(['unchanged', 'changed']);
  });

  it('is failed when any target errored', async () => {
    const run = await compareRun(runRoot, manifest(['same', 'moved', 'gone']), metadata);
    expect(run.status).toBe('failed');
  });

  it('writes a schema-valid run.json with only run-relative paths and no temp file', async () => {
    const run = await compareRun(runRoot, manifest(['same', 'moved', 'gone']), metadata);
    const path = await writeRunJson(runRoot, run);

    const text = await readFile(path, 'utf8');
    expect(VisualRunSchema.parse(JSON.parse(text))).toEqual(run);
    expect(text).not.toContain(runRoot);
    expect((await readdir(runRoot)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to write a run whose status disagrees with its changes', async () => {
    const run = await compareRun(runRoot, manifest(['moved']), metadata);
    await expect(writeRunJson(runRoot, { ...run, status: 'passed' })).rejects.toThrow();
    expect(existsSync(join(runRoot, 'run.json'))).toBe(false);
  });
});
