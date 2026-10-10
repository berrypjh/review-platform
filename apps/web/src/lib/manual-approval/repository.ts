import type { Db, Tx } from '../db/config.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  type Approver,
  type ApproveInput,
  type ObservedPullRequest,
  type PullRequestKey,
  type PullRequestRecord,
  PullRequestRecordSchema,
  type RevisionRecord,
  RevisionRecordSchema,
} from './schema.ts';
import {
  type ApprovalCheck,
  checkApproval,
  becomesObsolete,
  needsNewRevision,
  nextGeneration,
  pullRequestChanged,
  type Snapshot,
} from './state.ts';

/**
 * PR 단위 처리 권한. `fence`는 claim을 새로 얻을 때마다 늘어난다.
 * 이 claim으로 하는 DB 쓰기는 claim이 아직 유효할 때만 commit된다. GitHub 호출에는 이 보호가 닿지 않는다.
 */
export type Claim = PullRequestKey & { token: string; fence: number };

/** claim이 만료되어 다른 처리자에게 넘어갔다. 이 처리자의 결과는 버려야 한다. */
export class ClaimLostError extends Error {
  override name = 'ClaimLostError';
}

const PULL_REQUEST_COLUMNS = `
  id, repository_id AS "repositoryId", installation_id AS "installationId", number, owner, name, title,
  author_login AS "authorLogin", html_url AS "htmlUrl", head_sha AS "headSha", state,
  active_revision_id AS "activeRevisionId", blocked_reason AS "blockedReason", version, updated_at AS "updatedAt"`;

const REVISION_COLUMNS = `
  id, pull_request_id AS "pullRequestId", generation, head_sha AS "headSha", decision,
  approver_id AS "approverId", approver_login AS "approverLogin", decision_at AS "decisionAt",
  desired_check_state AS "desiredCheckState", sync_state AS "syncState",
  last_error AS "lastError", last_synced_at AS "lastSyncedAt", version, created_at AS "createdAt"`;

const toPullRequest = (row: unknown): PullRequestRecord => PullRequestRecordSchema.parse(row);
const toRevision = (row: unknown): RevisionRecord => RevisionRecordSchema.parse(row);

/** 승인 기록 결과. `approved`여도 GitHub 반영 전이다 — 화면은 `approvalStatus`로 Syncing을 보여 준다. */
export type ApprovalResult =
  { kind: 'approved'; revision: RevisionRecord } | Exclude<ApprovalCheck, { kind: 'approve' }>;

/** 반드시 한 행을 돌려주는 SQL(INSERT … RETURNING 등)의 결과. 없으면 버그다. */
function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('Expected exactly one row');
  return row;
}

/**
 * PR 처리 claim을 얻는다. 다른 처리자가 유효한 claim을 갖고 있으면 null이다.
 * 만료된 claim은 가져오며 fence가 하나 늘어난다. PR 행이 없어도(첫 webhook) 얻을 수 있다.
 */
export async function claimPullRequest(
  sql: Db,
  key: PullRequestKey,
  ttlMs: number,
): Promise<Claim | null> {
  const [row] = await sql<{ token: string; fence: number }[]>`
    INSERT INTO pull_request_claims (repository_id, number, token, fence, lease_until)
    VALUES (${key.repositoryId}, ${key.number}, gen_random_uuid(), 1, now() + make_interval(secs => ${ttlMs / 1000}))
    ON CONFLICT (repository_id, number) DO UPDATE
      SET token = excluded.token,
          fence = pull_request_claims.fence + 1,
          lease_until = excluded.lease_until
      WHERE pull_request_claims.lease_until <= now()
    RETURNING token, fence`;
  return row ? { ...key, token: row.token, fence: row.fence } : null;
}

/** claim을 즉시 만료시킨다. 이미 다른 처리자에게 넘어갔으면 아무것도 하지 않는다. */
export async function releaseClaim(sql: Db, claim: Claim): Promise<void> {
  await sql`
    UPDATE pull_request_claims SET lease_until = now()
    WHERE repository_id = ${claim.repositoryId} AND number = ${claim.number}
      AND token = ${claim.token} AND fence = ${claim.fence}`;
}

/**
 * claim이 유효할 때만 commit되는 transaction. claim 행을 잠가, 이 transaction이 끝나기 전에는
 * 다른 처리자가 claim을 가져가지 못한다. 이미 만료됐으면 `ClaimLostError`.
 */
function fenced<T>(sql: Db, claim: Claim, work: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(sql, async (tx) => {
    const [held] = await tx`
      SELECT 1 FROM pull_request_claims
      WHERE repository_id = ${claim.repositoryId} AND number = ${claim.number}
        AND token = ${claim.token} AND fence = ${claim.fence} AND lease_until > now()
      FOR UPDATE`;
    if (!held)
      throw new ClaimLostError(`Claim on PR ${claim.repositoryId}#${claim.number} was lost`);
    return work(tx);
  });
}

async function readSnapshot(
  tx: Tx | Db,
  key: PullRequestKey,
  lock: boolean,
): Promise<Snapshot | null> {
  const [pr] = await tx`
    SELECT ${tx.unsafe(PULL_REQUEST_COLUMNS)} FROM pull_requests
    WHERE repository_id = ${key.repositoryId} AND number = ${key.number}
    ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!pr) return null;
  const pullRequest = toPullRequest(pr);
  if (pullRequest.activeRevisionId === null) return { pullRequest, revision: null };
  const [revision] = await tx`
    SELECT ${tx.unsafe(REVISION_COLUMNS)} FROM revisions WHERE id = ${pullRequest.activeRevisionId}
    ${lock ? tx`FOR UPDATE` : tx``}`;
  return { pullRequest, revision: toRevision(revision) };
}

/** 저장된 PR과 active revision. 읽기 전용이라 claim이 필요 없다. DB 오류는 그대로 던진다. */
export const loadSnapshot = (sql: Db, key: PullRequestKey) => readSnapshot(sql, key, false);

/**
 * 목록 화면용 — 허용 저장소의 PR과 active revision. open PR을 먼저, 그다음 최근 갱신 순.
 * 허용 목록 밖 저장소의 행은 DB에 있어도 돌려주지 않는다.
 */
export async function listPullRequests(
  sql: Db,
  repositoryIds: readonly number[],
  limit: number,
): Promise<Snapshot[]> {
  if (repositoryIds.length === 0) return [];
  const pullRequests = (
    await sql`
      SELECT ${sql.unsafe(PULL_REQUEST_COLUMNS)} FROM pull_requests
      WHERE repository_id IN ${sql(repositoryIds)}
      ORDER BY (state = 'open') DESC, updated_at DESC, id DESC
      LIMIT ${limit}`
  ).map(toPullRequest);
  const ids = pullRequests.flatMap((pr) =>
    pr.activeRevisionId === null ? [] : [pr.activeRevisionId],
  );
  const revisions =
    ids.length === 0
      ? []
      : (
          await sql`SELECT ${sql.unsafe(REVISION_COLUMNS)} FROM revisions WHERE id IN ${sql(ids)}`
        ).map(toRevision);
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  return pullRequests.map((pullRequest) => ({
    pullRequest,
    revision:
      pullRequest.activeRevisionId === null
        ? null
        : (byId.get(pullRequest.activeRevisionId) ?? null),
  }));
}

/** PR의 모든 revision을 최신 generation부터. 과거 승인 이력 표시용이다. */
export async function listRevisions(sql: Db, pullRequestId: number): Promise<RevisionRecord[]> {
  const rows = await sql`
    SELECT ${sql.unsafe(REVISION_COLUMNS)} FROM revisions
    WHERE pull_request_id = ${pullRequestId} ORDER BY generation DESC`;
  return rows.map(toRevision);
}

/**
 * GitHub에서 **다시 읽은** PR을 반영한다. webhook payload를 넘기지 않는다 — 늦게 온 이벤트가 HEAD를 덮는다.
 * 새 HEAD · 재오픈이면 pending + queued 의도의 새 revision을 연다. 같은 관측을 반복하면 아무것도 바꾸지 않는다.
 */
export function applyObservation(
  sql: Db,
  claim: Claim,
  observed: ObservedPullRequest,
): Promise<Snapshot> {
  if (observed.repositoryId !== claim.repositoryId || observed.number !== claim.number) {
    throw new Error('Observed PR does not match the claim');
  }
  return fenced(sql, claim, async (tx) => {
    const current = await readSnapshot(tx, claim, true);
    const pullRequestId = current
      ? await updatePullRequest(tx, current.pullRequest, observed)
      : await insertPullRequest(tx, observed);
    const previous = current?.revision;
    if (previous && becomesObsolete(current, observed)) {
      await tx`
        UPDATE revisions SET desired_check_state = 'cancelled', sync_state = 'pending', version = version + 1
        WHERE id = ${previous.id} AND decision = 'pending'`;
    }
    if (needsNewRevision(current, observed)) {
      const revision = one(
        await tx<{ id: number }[]>`
        INSERT INTO revisions (pull_request_id, generation, head_sha)
        VALUES (${pullRequestId}, ${nextGeneration(current)}, ${observed.headSha})
        RETURNING id`,
      );
      await tx`
        UPDATE pull_requests SET active_revision_id = ${revision.id}, version = version + 1, updated_at = now()
        WHERE id = ${pullRequestId}`;
    }
    const after = await readSnapshot(tx, claim, false);
    if (!after) throw new Error('Observed PR was not stored');
    return after;
  });
}

async function insertPullRequest(tx: Tx, observed: ObservedPullRequest): Promise<number> {
  const row = one(
    await tx<{ id: number }[]>`
    INSERT INTO pull_requests (
      repository_id, installation_id, number, owner, name, title, author_login, html_url, head_sha, state
    ) VALUES (
      ${observed.repositoryId}, ${observed.installationId}, ${observed.number}, ${observed.owner},
      ${observed.name}, ${observed.title}, ${observed.authorLogin}, ${observed.htmlUrl},
      ${observed.headSha}, ${observed.state}
    ) RETURNING id`,
  );
  return row.id;
}

async function updatePullRequest(tx: Tx, stored: PullRequestRecord, observed: ObservedPullRequest) {
  if (!pullRequestChanged(stored, observed)) return stored.id;
  const updated = await tx`
    UPDATE pull_requests SET
      installation_id = ${observed.installationId}, owner = ${observed.owner}, name = ${observed.name},
      title = ${observed.title}, author_login = ${observed.authorLogin}, html_url = ${observed.htmlUrl},
      head_sha = ${observed.headSha}, state = ${observed.state},
      version = version + 1, updated_at = now()
    WHERE id = ${stored.id} AND version = ${stored.version}`;
  if (updated.count !== 1) throw new ClaimLostError(`PR ${stored.id} changed under the claim`);
  return stored.id;
}

/**
 * 승인 의사를 기록한다. 승인자는 서버가 세션에서 채운 값만 받는다.
 * 기록 뒤 revision은 `success` 반영 의도 + `pending` sync다. GitHub 반영 확인 전에는 Approved로 보이지 않는다.
 * 호출 전에 같은 claim으로 `applyObservation`을 해 DB가 GitHub의 현재 PR과 같아야 한다.
 */
export function recordApproval(
  sql: Db,
  claim: Claim,
  input: ApproveInput,
  approver: Approver,
): Promise<ApprovalResult> {
  return fenced(sql, claim, async (tx) => {
    const check = checkApproval(await readSnapshot(tx, claim, true), input);
    if (check.kind !== 'approve') return check;
    const [row] = await tx`
      UPDATE revisions SET
        decision = 'approved', approver_id = ${approver.githubUserId}, approver_login = ${approver.login},
        decision_at = now(), desired_check_state = 'success', sync_state = 'pending', last_error = NULL,
        version = version + 1
      WHERE id = ${check.revision.id} AND version = ${check.revision.version} AND decision = 'pending'
      RETURNING ${tx.unsafe(REVISION_COLUMNS)}`;
    if (!row) throw new ClaimLostError(`Revision ${check.revision.id} changed under the claim`);
    await tx`UPDATE pull_requests SET version = version + 1, updated_at = now() WHERE id = ${check.revision.pullRequestId}`;
    return { kind: 'approved', revision: toRevision(row) };
  });
}

export type SyncOutcome = { state: 'synced' } | { state: 'error' | 'unknown'; error: string };

/**
 * GitHub 반영 결과를 기록한다. `revisionVersion`은 반영을 시작할 때 읽은 의도의 version이다.
 * 그사이 승인 등으로 의도가 바뀌었으면 기록하지 않고 `stale`을 돌려준다 — 오래된 결과가 새 의도를 synced로 만들지 않는다.
 * `error`에 secret · 토큰을 넣지 않는다.
 */
export function recordSyncResult(
  sql: Db,
  claim: Claim,
  revisionId: number,
  revisionVersion: number,
  outcome: SyncOutcome,
): Promise<'recorded' | 'stale'> {
  return fenced(sql, claim, async (tx) => {
    const error = outcome.state === 'synced' ? null : outcome.error.slice(0, 500);
    const updated = await tx`
      UPDATE revisions SET
        sync_state = ${outcome.state},
        last_error = ${error},
        last_synced_at = CASE WHEN ${outcome.state} = 'synced' THEN now() ELSE last_synced_at END
      WHERE id = ${revisionId} AND version = ${revisionVersion}`;
    return updated.count === 1 ? 'recorded' : 'stale';
  });
}

/** 아직 GitHub에 반영되지 않은 revision들. active가 아닌 cancelled 의도도 포함한다. 오래된 generation부터. */
export async function listRevisionsToSync(
  sql: Db,
  pullRequestId: number,
): Promise<RevisionRecord[]> {
  const rows = await sql`
    SELECT ${sql.unsafe(REVISION_COLUMNS)} FROM revisions
    WHERE pull_request_id = ${pullRequestId} AND sync_state <> 'synced'
    ORDER BY generation`;
  return rows.map(toRevision);
}

/** 재동기화 대상 PR — 반영되지 않은 revision이 하나라도 있는 것. 차단된 PR은 제외. 오래된 것부터. */
export async function listUnsynced(sql: Db, limit: number): Promise<PullRequestKey[]> {
  return sql<PullRequestKey[]>`
    SELECT p.repository_id AS "repositoryId", p.number
    FROM pull_requests p
    WHERE p.blocked_reason IS NULL
      AND EXISTS (SELECT 1 FROM revisions r WHERE r.pull_request_id = p.id AND r.sync_state <> 'synced')
    ORDER BY p.updated_at
    LIMIT ${limit}`;
}

/**
 * installation 정지 · 삭제 시 그 installation의 PR을 차단하고, unsuspend면(`reason` null) 정지 차단만 푼다.
 * 차단된 PR은 승인 · 재동기화 대상이 아니다. 바뀐 PR 수를 돌려준다.
 */
export async function setInstallationBlocked(
  sql: Db,
  installationId: number,
  reason: 'installation-suspended' | 'installation-deleted' | null,
): Promise<number> {
  const updated = reason
    ? await sql`
        UPDATE pull_requests SET blocked_reason = ${reason}, version = version + 1, updated_at = now()
        WHERE installation_id = ${installationId}`
    : await sql`
        UPDATE pull_requests SET blocked_reason = NULL, version = version + 1, updated_at = now()
        WHERE installation_id = ${installationId} AND blocked_reason = 'installation-suspended'`;
  return updated.count;
}

/** installation에서 빠진 저장소의 PR을 차단한다. 다시 추가돼도 자동으로 풀지 않는다 — 재동기화가 확인한다. */
export async function blockRepositories(sql: Db, repositoryIds: number[]): Promise<number> {
  if (repositoryIds.length === 0) return 0;
  const updated = await sql`
    UPDATE pull_requests SET blocked_reason = 'repository-removed', version = version + 1, updated_at = now()
    WHERE repository_id IN ${sql(repositoryIds)}`;
  return updated.count;
}

/** 재동기화가 installation token으로 저장소 접근을 다시 확인했을 때 그 저장소 PR의 차단을 푼다. */
export async function clearRepositoryBlock(sql: Db, repositoryId: number): Promise<number> {
  const updated = await sql`
    UPDATE pull_requests SET blocked_reason = NULL, version = version + 1, updated_at = now()
    WHERE repository_id = ${repositoryId} AND blocked_reason IS NOT NULL`;
  return updated.count;
}
