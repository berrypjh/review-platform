import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase, type TestDatabase } from '../db/test-database.ts';
import { GitHubApiError } from '../github/http.ts';
import { approvePullRequest } from './approve.ts';
import { reconcile, reconcilePullRequest } from './reconcile.ts';
import { loadSnapshot } from './repository.ts';
import { approvalStatus } from './state.ts';
import {
  BLOG,
  NOT_ALLOWED,
  OPERATOR,
  pullRequestPayload,
  sha,
  SHARED_STACK,
  signedWebhook,
  testHarness,
} from './test-support.ts';
import { handleWebhook } from './webhook.ts';

const A = sha('a');
const B = sha('b');
const KEY = { repositoryId: SHARED_STACK.id, number: 7 };

let db: TestDatabase;
let h: ReturnType<typeof testHarness>;

beforeEach(async () => {
  db = await openTestDatabase();
  h = testHarness(db.sql);
});

afterEach(async () => {
  await db.close();
});

/** GitHub에 PR을 만들고 opened webhook으로 등록한다. */
async function openPull(number = 7, headSha = A) {
  const pull = h.github.addPull({ repositoryId: SHARED_STACK.id, number, headSha });
  const result = await handleWebhook(
    h.deps(),
    signedWebhook(h.config, 'pull_request', pullRequestPayload(SHARED_STACK, number, 'opened')),
  );
  expect(result.result).toBe('processed');
  return pull;
}

const approve = (
  expectedHeadSha: string,
  expectedRevision: number,
  deadlineMs = 8_000,
  number = 7,
) =>
  approvePullRequest(
    h.deps(deadlineMs),
    { repositoryId: SHARED_STACK.id, number },
    { expectedHeadSha, expectedRevision },
    OPERATOR,
  );

const snapshot = async () => {
  const found = await loadSnapshot(db.sql, KEY);
  if (!found) throw new Error('PR is not stored');
  return found;
};
/** PR 화면에 보이는 이 context의 status 상태. */
const shown = (sha: string) => h.github.latestStatus(sha)?.state;
const successPosts = () => h.github.statuses.filter((status) => status.state === 'success');
const STATUS_POST = /\/statuses\/[0-9a-f]{40}$/;

describe('approval', () => {
  it('approves the current head and marks only that commit success', async () => {
    await openPull();
    const outcome = await approve(A, 1);
    expect(outcome.kind).toBe('approved');
    expect(h.github.latestStatus(A)).toMatchObject({
      state: 'success',
      description: expect.stringContaining('Approved by @operator'),
    });
    expect((await snapshot()).revision).toMatchObject({
      decision: 'approved',
      syncState: 'synced',
    });
  });

  it('rejects a stale head with a conflict and syncs the latest revision', async () => {
    const pull = await openPull();
    pull.headSha = B;
    expect(await approve(A, 1)).toEqual({ kind: 'conflict', reason: 'revision-changed' });
    expect(successPosts()).toEqual([]);
    expect(shown(B)).toBe('pending');
    expect(shown(A)).toBe('error');
  });

  it('keeps the first decision when the same revision is approved twice', async () => {
    await openPull();
    await approve(A, 1);
    const again = await approvePullRequest(
      h.deps(),
      KEY,
      { expectedHeadSha: A, expectedRevision: 1 },
      { githubUserId: 43, login: 'second' },
    );
    expect(again.kind).toBe('approved');
    expect((await snapshot()).revision).toMatchObject({
      approverId: 42,
      approverLogin: 'operator',
    });
    expect(successPosts()).toHaveLength(1);
  });

  it('does not carry an approval to a head pushed during the approval', async () => {
    const pull = await openPull();
    h.github.beforeRequest = (method, path) => {
      if (method === 'POST' && STATUS_POST.test(path)) pull.headSha = B;
    };
    expect(await approve(A, 1)).toEqual({
      kind: 'conflict',
      reason: 'head-changed-after-approval',
    });
    expect(shown(A)).toBe('success');
    expect(shown(B)).toBe('pending');
    const stored = await snapshot();
    expect(stored.revision).toMatchObject({ generation: 2, headSha: B, decision: 'pending' });
    expect(approvalStatus(stored)).toBe('pending');
  });

  it('refuses a head shared by another open PR', async () => {
    await openPull(7, A);
    await openPull(8, A);
    expect(await approve(A, 1)).toEqual({ kind: 'conflict', reason: 'shared-head' });
    expect(successPosts()).toEqual([]);
  });

  it('refuses when it cannot read every page of PRs sharing the head', async () => {
    await openPull();
    for (let number = 100; number < 111; number++) {
      h.github.addPull({ repositoryId: SHARED_STACK.id, number, headSha: A, state: 'closed' });
    }
    h.github.commitPullsPerPage = 1;
    expect(await approve(A, 1)).toEqual({ kind: 'conflict', reason: 'shared-head-unknown' });
    expect(successPosts()).toEqual([]);
  });

  it('refuses a closed PR and a repository outside the allowlist', async () => {
    const pull = await openPull();
    pull.state = 'closed';
    expect(await approve(A, 1)).toEqual({ kind: 'conflict', reason: 'not-open' });
    expect(
      await approvePullRequest(
        h.deps(),
        { repositoryId: NOT_ALLOWED.id, number: 1 },
        { expectedHeadSha: A, expectedRevision: 1 },
        OPERATOR,
      ),
    ).toEqual({ kind: 'forbidden-repository' });
  });

  it('fails closed when GitHub refuses the installation token', async () => {
    await openPull();
    h.github.suspended = true;
    await expect(approve(A, 1)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await snapshot()).revision?.decision).toBe('pending');
  });
});

describe('approval recovery', () => {
  it('does not report approved after a status timeout, and reconcile converges to success', async () => {
    await openPull();
    h.github.fail('POST', STATUS_POST, { kind: 'timeout' });
    await expect(approve(A, 1, 1_500)).rejects.toBeInstanceOf(GitHubApiError);
    const pending = await snapshot();
    expect(pending.revision).toMatchObject({ decision: 'approved', syncState: 'unknown' });
    expect(approvalStatus(pending)).toBe('sync-unknown');

    expect(await reconcilePullRequest(h.deps(), KEY)).toBe('synced');
    expect(approvalStatus(await snapshot())).toBe('approved');
    expect(shown(A)).toBe('success');
  });

  it('does not report approved when GitHub succeeds but the DB result is lost', async () => {
    await openPull();
    h.github.beforeRequest = async (method, path) => {
      if (method === 'POST' && STATUS_POST.test(path))
        await db.sql`UPDATE pull_request_claims SET lease_until = now() - interval '1 second'`;
    };
    await expect(approve(A, 1)).rejects.toMatchObject({ name: 'ClaimLostError' });
    expect(shown(A)).toBe('success');
    expect(approvalStatus(await snapshot())).toBe('syncing');

    h.github.beforeRequest = null;
    expect(await reconcilePullRequest(h.deps(), KEY)).toBe('synced');
    expect(approvalStatus(await snapshot())).toBe('approved');
    // 같은 의도를 다시 보낸다. 보이는 상태는 여전히 success 하나다.
    expect(shown(A)).toBe('success');
  });

  it('retries a failed approval without creating a second decision', async () => {
    await openPull();
    h.github.fail('POST', STATUS_POST, { kind: 'status', status: 500 });
    const first = await approve(A, 1);
    expect(first.kind).toBe('not-confirmed');
    const decidedAt = (await snapshot()).revision?.decisionAt;

    expect((await approve(A, 1)).kind).toBe('approved');
    const stored = await snapshot();
    expect(stored.revision?.decisionAt).toEqual(decidedAt);
    expect(await db.sql`SELECT 1 FROM revisions WHERE decision = 'approved'`).toHaveLength(1);
  });
});

describe('reconcile', () => {
  it('bootstraps existing open PRs of every allowed repository', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 1, headSha: A });
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 2, headSha: B });
    h.github.addPull({ repositoryId: BLOG.id, number: 3, headSha: sha('c') });
    h.github.addPull({ repositoryId: NOT_ALLOWED.id, number: 4, headSha: sha('d') });

    const report = await reconcile(h.deps(30_000), null);
    expect(report).toEqual({ processed: 3, notSynced: [], cursor: null });
    expect(h.github.statuses.map((status) => status.sha).sort()).toEqual([A, B, sha('c')]);
    expect(h.github.statuses.every((status) => status.state === 'pending')).toBe(true);
  });

  it('returns a continuation cursor instead of running past the deadline', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 1, headSha: A });
    expect(await reconcile(h.deps(4_000), null)).toMatchObject({ processed: 0, cursor: '0:1' });
    expect(await reconcile(h.deps(30_000), '1:1')).toMatchObject({ processed: 0, cursor: null });
    expect(await reconcile(h.deps(30_000), '0:1')).toMatchObject({ processed: 1, cursor: null });
  });
});
