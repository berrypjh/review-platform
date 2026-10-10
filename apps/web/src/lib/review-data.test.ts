import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { VisualRun } from '@review-platform/visual-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRuns, loadRun, readArtifactPng, reviewDataDir } from './review-data';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const run = (id: string, createdAt: string): VisualRun => ({
  schemaVersion: 1,
  id,
  repository: 'example/design-system',
  baseSha: 'a1b2c3d',
  headSha: 'e4f5a6b',
  createdAt,
  browser: 'chromium',
  viewport: { width: 4, height: 3 },
  status: 'passed',
  changes: [
    {
      id: 'button--primary',
      label: 'Button',
      targetPath: 'iframe.html?id=button--primary',
      status: 'unchanged',
      baselinePath: 'baseline/button--primary.png',
      currentPath: 'current/button--primary.png',
      diffPath: null,
      mismatchPixels: 0,
      mismatchRatio: 0,
      error: null,
    },
  ],
});

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'review-data-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true });
});

async function put(relativePath: string, content: string | Buffer) {
  const path = join(dataDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe('loadRun', () => {
  it('loads a valid run', async () => {
    await put('runs/older/run.json', JSON.stringify(run('older', '2026-09-24T10:00:00Z')));
    expect(await loadRun(dataDir, 'older')).toMatchObject({ ok: true, run: { id: 'older' } });
  });

  it('rejects run.json that is not JSON', async () => {
    await put('runs/broken/run.json', '{ not json');
    expect(await loadRun(dataDir, 'broken')).toMatchObject({
      ok: false,
      reason: 'invalid-contract',
    });
  });

  it('rejects a run that breaks the contract', async () => {
    const malformed = { ...run('bad', '2026-09-24T10:00:00Z'), status: 'failed' };
    await put('runs/bad/run.json', JSON.stringify(malformed));
    expect(await loadRun(dataDir, 'bad')).toMatchObject({
      ok: false,
      reason: 'invalid-contract',
    });
  });

  it('rejects a run whose id does not match its directory', async () => {
    await put('runs/folder/run.json', JSON.stringify(run('other', '2026-09-24T10:00:00Z')));
    expect(await loadRun(dataDir, 'folder')).toMatchObject({
      ok: false,
      reason: 'invalid-contract',
    });
  });

  it('distinguishes a captured-but-not-compared run from a missing run', async () => {
    await put('runs/captured/baseline/button--primary.png', PNG_BYTES);
    expect(await loadRun(dataDir, 'captured')).toMatchObject({ reason: 'not-compared' });
    expect(await loadRun(dataDir, 'nothing')).toMatchObject({ reason: 'not-found' });
    expect(await loadRun(dataDir, '../escape')).toMatchObject({ reason: 'not-found' });
  });
});

describe('listRuns', () => {
  it('returns no runs when the runs directory does not exist', async () => {
    expect(await listRuns(dataDir)).toEqual({ runs: [], problems: [] });
  });

  it('sorts valid runs newest first and reports the rest as problems', async () => {
    await put('runs/older/run.json', JSON.stringify(run('older', '2026-09-24T10:00:00Z')));
    await put('runs/newer/run.json', JSON.stringify(run('newer', '2026-09-24T11:00:00.500Z')));
    await put('runs/broken/run.json', '{');

    const listing = await listRuns(dataDir);

    expect(listing.runs.map((r) => r.id)).toEqual(['newer', 'older']);
    expect(listing.problems).toEqual([
      { runId: 'broken', reason: 'invalid-contract', detail: 'run.json is not valid JSON.' },
    ]);
  });
});

describe('readArtifactPng', () => {
  beforeEach(async () => {
    await put('runs/sample/diff/card.png', PNG_BYTES);
    await put('runs/sample/current/fake.png', 'not a png');
    await put('secret.png', PNG_BYTES);
  });

  it('returns the bytes of a PNG inside the run', async () => {
    expect(await readArtifactPng(dataDir, 'sample', ['diff', 'card.png'])).toEqual(
      new Uint8Array(PNG_BYTES),
    );
  });

  it.each([
    ['a parent segment', 'sample', ['..', '..', 'secret.png']],
    ['parent segments after a valid prefix', 'sample', ['diff', '..', '..', '..', 'secret.png']],
    ['a non-PNG extension', 'sample', ['run.json']],
    ['an invalid run id', '..', ['secret.png']],
    ['a missing file', 'sample', ['diff', 'missing.png']],
    ['a file without a PNG signature', 'sample', ['current', 'fake.png']],
  ])('returns null for %s', async (_, runId, segments) => {
    expect(await readArtifactPng(dataDir, runId, segments)).toBeNull();
  });

  it('returns null for a symlink that points outside the data directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    await writeFile(join(outside, 'leak.png'), PNG_BYTES);
    await symlink(join(outside, 'leak.png'), join(dataDir, 'runs/sample/diff/leak.png'));

    expect(await readArtifactPng(dataDir, 'sample', ['diff', 'leak.png'])).toBeNull();
    await rm(outside, { recursive: true });
  });
});

describe('reviewDataDir', () => {
  const cwd = process.cwd();
  const env = process.env['REVIEW_DATA_DIR'];
  afterEach(() => {
    process.chdir(cwd);
    if (env === undefined) delete process.env['REVIEW_DATA_DIR'];
    else process.env['REVIEW_DATA_DIR'] = env;
  });

  it('resolves a relative directory from the workspace root', () => {
    process.env['REVIEW_DATA_DIR'] = 'fixtures/visual/review-data';
    expect(reviewDataDir()).toMatch(/\/fixtures\/visual\/review-data$/);
    expect(reviewDataDir()).not.toContain('/apps/web/');
  });

  // 서버리스 번들처럼 pnpm-workspace.yaml이 없는 곳에서도 절대 경로는 그대로 쓴다
  it('uses an absolute directory without looking for the workspace root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'no-workspace-'));
    try {
      process.chdir(outside);
      process.env['REVIEW_DATA_DIR'] = join(outside, 'review-data');
      expect(reviewDataDir()).toBe(join(outside, 'review-data'));
    } finally {
      process.chdir(cwd);
      await rm(outside, { recursive: true });
    }
  });
});
