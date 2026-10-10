import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, readDatabaseConfig } from '../db/config.ts';
import { openTestDatabase, present, type TestDatabase } from '../db/test-database.ts';
import {
  applyObservation,
  type Claim,
  ClaimLostError,
  claimPullRequest,
  listRevisions,
  listPullRequests,
  listRevisionsToSync,
  listUnsynced,
  loadSnapshot,
  recordApproval,
  recordSyncResult,
  releaseClaim,
} from './repository.ts';
import type { ObservedPullRequest } from './schema.ts';
import { approvalStatus, syncIntent } from './state.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const KEY = { repositoryId: 101, number: 7 };
const OPERATOR = { githubUserId: 42, login: 'operator' };
const SECOND = { githubUserId: 43, login: 'second' };

const observed = (overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest => ({
  ...KEY,
  installationId: 9,
  owner: 'berrypjh',
  name: 'shared-stack',
  title: 'Add button',
  authorLogin: 'octocat',
  htmlUrl: 'https://github.com/berrypjh/shared-stack/pull/7',
  headSha: SHA_A,
  state: 'open',
  ...overrides,
});

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

afterEach(async () => {
  await db.close();
});

/** claim → 반영 → 해제. webhook 한 번의 DB 쪽 흐름이다. */
async function observe(pr: ObservedPullRequest) {
  const claim = present(await claimPullRequest(db.sql, KEY, 10_000));
  try {
    return await applyObservation(db.sql, claim, pr);
  } finally {
    await releaseClaim(db.sql, claim);
  }
}

async function approve(expectedHeadSha: string, expectedRevision: number, approver = OPERATOR) {
  const claim = present(await claimPullRequest(db.sql, KEY, 10_000));
  try {
    return await recordApproval(db.sql, claim, { expectedHeadSha, expectedRevision }, approver);
  } finally {
    await releaseClaim(db.sql, claim);
  }
}

async function sync(revisionVersion: number, revisionId: number, checkRunId = 5001) {
  const claim = present(await claimPullRequest(db.sql, KEY, 10_000));
  try {
    return await recordSyncResult(db.sql, claim, revisionId, revisionVersion, {
      state: 'synced',
      checkRunId,
    });
  } finally {
    await releaseClaim(db.sql, claim);
  }
}

describe('observation', () => {
  it('starts a new PR at generation 1 with a pending decision and a queued check intent', async () => {
    const snapshot = await observe(observed());
    expect(snapshot.revision).toMatchObject({
      generation: 1,
      headSha: SHA_A,
      decision: 'pending',
      desiredCheckState: 'queued',
      syncState: 'pending',
    });
    expect(approvalStatus(snapshot)).toBe('pending');
    expect(syncIntent(snapshot)).toMatchObject({ desired: 'queued', externalId: 'rp:101:7:1' });
  });

  it('does not bump the generation or version when the same event is processed twice', async () => {
    const first = await observe(observed());
    const second = await observe(observed());
    expect(second.revision?.generation).toBe(1);
    expect(second.pullRequest.version).toBe(first.pullRequest.version);
  });

  it('keeps the identity when the repository is renamed', async () => {
    const first = await observe(observed());
    const renamed = await observe(observed({ owner: 'berry', name: 'stack' }));
    expect(renamed.pullRequest).toMatchObject({
      id: first.pullRequest.id,
      owner: 'berry',
      name: 'stack',
    });
    expect(renamed.revision?.generation).toBe(1);
  });

  it('opens a new generation for A -> B -> A and never revives the approval of A', async () => {
    await observe(observed());
    expect((await approve(SHA_A, 1)).kind).toBe('approved');
    await observe(observed({ headSha: SHA_B }));
    const backAtA = await observe(observed({ headSha: SHA_A }));
    expect(backAtA.revision).toMatchObject({ generation: 3, headSha: SHA_A, decision: 'pending' });
    expect(approvalStatus(backAtA)).toBe('pending');
    expect(await approve(SHA_A, 1)).toEqual({ kind: 'rejected', reason: 'revision-changed' });
  });

  it('keeps history when closed and opens a new generation when reopened', async () => {
    await observe(observed());
    await approve(SHA_A, 1);
    const closed = await observe(observed({ state: 'closed' }));
    expect(approvalStatus(closed)).toBe('closed');
    expect(await approve(SHA_A, 1)).toEqual({ kind: 'rejected', reason: 'not-open' });

    const reopened = await observe(observed());
    expect(reopened.revision).toMatchObject({ generation: 2, decision: 'pending' });
    const history = await listRevisions(db.sql, reopened.pullRequest.id);
    expect(history.map((revision) => [revision.generation, revision.decision])).toEqual([
      [2, 'pending'],
      [1, 'approved'],
    ]);
  });
});

describe('obsolete revisions', () => {
  it('asks to cancel the waiting check of a superseded pending revision', async () => {
    const first = await observe(observed());
    const next = await observe(observed({ headSha: SHA_B }));
    const old = (await listRevisionsToSync(db.sql, next.pullRequest.id)).find(
      (revision) => revision.id === present(first.revision).id,
    );
    expect(old).toMatchObject({ desiredCheckState: 'cancelled', syncState: 'pending' });
  });

  it('cancels on close but keeps an approved revision as it is', async () => {
    await observe(observed());
    await approve(SHA_A, 1);
    const closed = await observe(observed({ state: 'closed' }));
    expect(closed.revision).toMatchObject({ decision: 'approved', desiredCheckState: 'success' });

    await observe(observed());
    const reopenedThenClosed = await observe(observed({ state: 'closed' }));
    expect(reopenedThenClosed.revision).toMatchObject({
      generation: 2,
      desiredCheckState: 'cancelled',
    });
  });
});

describe('approval', () => {
  it('records the decision but reports syncing until GitHub confirms', async () => {
    await observe(observed());
    const result = await approve(SHA_A, 1);
    expect(result).toMatchObject({
      kind: 'approved',
      revision: {
        decision: 'approved',
        approverId: 42,
        approverLogin: 'operator',
        syncState: 'pending',
      },
    });
    const snapshot = present(await loadSnapshot(db.sql, KEY));
    expect(approvalStatus(snapshot)).toBe('syncing');
    expect(syncIntent(snapshot)?.desired).toBe('success');
  });

  it('rejects a stale head without writing anything', async () => {
    await observe(observed());
    expect(await approve(SHA_B, 1)).toEqual({ kind: 'rejected', reason: 'head-changed' });
    expect(present(await loadSnapshot(db.sql, KEY)).revision?.decision).toBe('pending');
  });

  it('keeps the first approver when the same revision is approved again', async () => {
    await observe(observed());
    await approve(SHA_A, 1, OPERATOR);
    const again = await approve(SHA_A, 1, SECOND);
    expect(again).toMatchObject({ kind: 'already-approved', revision: { approverId: 42 } });
  });

  it('serializes two concurrent approvals on the database row lock', async () => {
    await observe(observed());
    const claim = present(await claimPullRequest(db.sql, KEY, 10_000));
    const other = db.connect();
    const input = { expectedHeadSha: SHA_A, expectedRevision: 1 };
    const results = await Promise.all([
      recordApproval(db.sql, claim, input, OPERATOR),
      recordApproval(other, claim, input, SECOND),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['already-approved', 'approved']);
    const revisions = await db.sql`SELECT approver_id FROM revisions WHERE decision = 'approved'`;
    expect(revisions).toHaveLength(1);
  });

  it('survives a process restart', async () => {
    await observe(observed());
    await approve(SHA_A, 1);
    await db.sql.end();
    const restarted = db.connect();
    const snapshot = present(await loadSnapshot(restarted, KEY));
    expect(snapshot.revision).toMatchObject({ decision: 'approved', approverId: 42 });
  });
});

describe('claims', () => {
  it('lets only one of two concurrent workers claim a PR', async () => {
    const claims = await Promise.all([
      claimPullRequest(db.sql, KEY, 10_000),
      claimPullRequest(db.connect(), KEY, 10_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('hands an expired claim to the next worker and fences out the old one', async () => {
    const old = present(await claimPullRequest(db.sql, KEY, 50));
    expect(await claimPullRequest(db.sql, KEY, 10_000)).toBeNull();
    await sleep(100);
    const next = present(await claimPullRequest(db.sql, KEY, 10_000));
    expect(next.fence).toBe(old.fence + 1);

    await expect(applyObservation(db.sql, old, observed())).rejects.toBeInstanceOf(ClaimLostError);
    await releaseClaim(db.sql, old);
    await expect(applyObservation(db.sql, next, observed())).resolves.toMatchObject({
      revision: { generation: 1 },
    });
  });

  it('refuses writes from an expired claim even before anyone else takes it', async () => {
    const expired = present(await claimPullRequest(db.sql, KEY, 50));
    await sleep(100);
    await expect(applyObservation(db.sql, expired, observed())).rejects.toBeInstanceOf(
      ClaimLostError,
    );
    expect(await loadSnapshot(db.sql, KEY)).toBeNull();
  });

  it('rolls back the whole observation when the claim is lost', async () => {
    const lost: Claim = { ...KEY, token: '00000000-0000-4000-8000-000000000000', fence: 1 };
    await expect(applyObservation(db.sql, lost, observed())).rejects.toBeInstanceOf(ClaimLostError);
    expect(await loadSnapshot(db.sql, KEY)).toBeNull();
  });
});

describe('sync results', () => {
  it('discards a late result for an intent that has since changed', async () => {
    const queued = present((await observe(observed())).revision);
    await approve(SHA_A, 1);
    expect(await sync(queued.version, queued.id)).toBe('stale');
    expect(approvalStatus(present(await loadSnapshot(db.sql, KEY)))).toBe('syncing');

    const current = present(present(await loadSnapshot(db.sql, KEY)).revision);
    expect(await sync(current.version, current.id)).toBe('recorded');
    const snapshot = present(await loadSnapshot(db.sql, KEY));
    expect(approvalStatus(snapshot)).toBe('approved');
    expect(snapshot.revision?.checkRunId).toBe(5001);
  });

  it('never reports approved for an error or unknown result', async () => {
    await observe(observed());
    await approve(SHA_A, 1);
    for (const state of ['error', 'unknown'] as const) {
      const revision = present(present(await loadSnapshot(db.sql, KEY)).revision);
      const claim = present(await claimPullRequest(db.sql, KEY, 10_000));
      await recordSyncResult(db.sql, claim, revision.id, revision.version, {
        state,
        error: 'timeout',
      });
      await releaseClaim(db.sql, claim);
      expect(approvalStatus(present(await loadSnapshot(db.sql, KEY)))).not.toBe('approved');
    }
    expect(await listUnsynced(db.sql, 10)).toEqual([KEY]);
  });
});

describe('constraints', () => {
  it('rejects a duplicate PR and a duplicate generation', async () => {
    const snapshot = await observe(observed());
    await expect(db.sql`
      INSERT INTO pull_requests (repository_id, installation_id, number, owner, name, title, author_login, html_url, head_sha, state)
      VALUES (101, 9, 7, 'x', 'y', 't', 'a', 'https://example.com', ${SHA_A}, 'open')`).rejects.toMatchObject(
      {
        code: '23505',
      },
    );
    await expect(db.sql`
      INSERT INTO revisions (pull_request_id, generation, head_sha)
      VALUES (${snapshot.pullRequest.id}, 1, ${SHA_B})`).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects an approved revision without an approver', async () => {
    const snapshot = await observe(observed());
    await expect(db.sql`
      UPDATE revisions SET decision = 'approved', desired_check_state = 'success'
      WHERE id = ${present(snapshot.revision).id}`).rejects.toMatchObject({ code: '23514' });
  });
});

describe('listPullRequests', () => {
  it('lists open PRs first, only for the given repositories, with their active revision', async () => {
    const claimed = async (pr: ObservedPullRequest) => {
      const claim = present(await claimPullRequest(db.sql, pr, 10_000));
      await applyObservation(db.sql, claim, pr);
      await releaseClaim(db.sql, claim);
    };
    await claimed(observed({ number: 1, state: 'closed' }));
    await claimed(observed({ number: 2 }));
    await claimed(observed({ number: 3 }));
    await claimed(observed({ repositoryId: 999, number: 4 }));

    const listed = await listPullRequests(db.sql, [101], 10);
    expect(listed.map((snapshot) => snapshot.pullRequest.number)).toEqual([3, 2, 1]);
    expect(listed[0]?.revision).toMatchObject({ generation: 1, headSha: SHA_A });
    expect(listed[2]?.revision).toBeNull();
    expect(await listPullRequests(db.sql, [], 10)).toEqual([]);
  });
});

describe('database outage', () => {
  it('fails instead of reporting a status when the database is unreachable', async () => {
    const down = openDatabase(
      readDatabaseConfig({ DATABASE_URL: 'postgres://review@127.0.0.1:1/none' }),
    );
    try {
      await expect(loadSnapshot(down, KEY)).rejects.toThrow();
    } finally {
      await down.end();
    }
  });
});
