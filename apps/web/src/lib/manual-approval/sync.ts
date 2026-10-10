import { setTimeout as sleep } from 'node:timers/promises';

import type { Db } from '../db/config.ts';
import type { GitHubApi, RepositoryRef } from '../github/api.ts';
import { confirmsIntent, createCheck, findOwnChecks, updateCheck } from '../github/checks.ts';
import { GitHubApiError } from '../github/http.ts';
import { openPullsWithHead } from '../github/pulls.ts';
import {
  type Claim,
  ClaimLostError,
  claimPullRequest,
  listRevisionsToSync,
  loadSnapshot,
  recordSyncResult,
  type SyncOutcome,
} from './repository.ts';
import type { PullRequestKey, PullRequestRecord, RevisionRecord } from './schema.ts';
import { revisionSyncIntent, type SyncIntent } from './state.ts';

/** orchestration이 쓰는 의존. 런타임은 실제 DB · fetch, 테스트는 테스트 DB · 가짜 transport를 넣는다. */
export type ApprovalDeps = { sql: Db; github: GitHubApi };

/** claim 유효 시간. GitHub 호출 몇 번이 deadline 안에 끝나는 길이다. */
export const CLAIM_TTL_MS = 30_000;

/** PR claim을 `waitMs`까지 기다려 얻는다. 못 얻으면 null — 다른 처리자가 같은 PR을 처리 중이다. */
export async function acquireClaim(
  sql: Db,
  key: PullRequestKey,
  waitMs: number,
): Promise<Claim | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const claim = await claimPullRequest(sql, key, CLAIM_TTL_MS);
    if (claim || Date.now() >= until) return claim;
    await sleep(200);
  }
}

export const repositoryOf = (pullRequest: PullRequestRecord): RepositoryRef => ({
  repositoryId: pullRequest.repositoryId,
  owner: pullRequest.owner,
  name: pullRequest.name,
});

/** 오류를 sync 결과로. 반영 여부를 알 수 없는 실패(timeout · 응답 유실 · 5xx)는 unknown이다. */
function failure(error: unknown, checkRunId: number | null): SyncOutcome {
  const unknown = error instanceof GitHubApiError && error.outcomeUnknown;
  return {
    state: unknown ? 'unknown' : 'error',
    error: error instanceof Error ? error.message : 'Unknown sync failure',
    ...(checkRunId === null ? {} : { checkRunId }),
  };
}

/**
 * 같은 external_id의 run이 여럿이면 가장 작은 id를 canonical로 쓰고, 나머지 미완료 run만 cancelled로 닫는다.
 * 이 App이 만든 run만 대상이다.
 */
async function adoptExisting(
  github: GitHubApi,
  repo: RepositoryRef,
  intent: SyncIntent,
  revision: RevisionRecord,
): Promise<number | null> {
  const mine = (await findOwnChecks(github, repo, intent.headSha))
    .filter((run) => run.external_id === intent.externalId)
    .sort((a, b) => a.id - b.id);
  for (const duplicate of mine.slice(1)) {
    if (duplicate.status !== 'completed') {
      await updateCheck(github, repo, duplicate.id, { ...intent, desired: 'cancelled' }, revision);
    }
  }
  return mine[0]?.id ?? null;
}

/** success로 바꾸기 전 확인. 같은 SHA의 다른 open PR이 있거나 다 확인하지 못했으면 반영하지 않는다. */
async function sharedHeadProblem(
  github: GitHubApi,
  repo: RepositoryRef,
  pullRequest: PullRequestRecord,
  sha: string,
) {
  const { numbers, complete } = await openPullsWithHead(github, repo, sha);
  if (!complete) return 'shared-head-unknown' as const;
  return numbers.some((number) => number !== pullRequest.number) ? ('shared-head' as const) : null;
}

/**
 * revision 하나를 GitHub에 반영하고 결과를 기록한다. DB 기록은 claim · version이 유효할 때만 된다.
 * GitHub 호출과 DB 기록은 한 transaction이 아니다 — 반영 뒤 기록이 실패하면 sync는 pending으로 남고 재동기화가 같은 일을 반복한다.
 */
export async function syncRevision(
  { sql, github }: ApprovalDeps,
  claim: Claim,
  pullRequest: PullRequestRecord,
  revision: RevisionRecord,
): Promise<RevisionRecord['syncState']> {
  const intent = revisionSyncIntent(pullRequest, revision);
  if (!intent) return 'synced';
  const repo = repositoryOf(pullRequest);
  let checkRunId = intent.checkRunId;
  let outcome: SyncOutcome;
  try {
    checkRunId ??= await adoptExisting(github, repo, intent, revision);
    if (intent.desired === 'success') {
      const problem = await sharedHeadProblem(github, repo, pullRequest, intent.headSha);
      if (problem) throw new Error(`Not marking ${intent.headSha} as approved: ${problem}`);
    }
    if (checkRunId === null && intent.desired === 'cancelled') {
      outcome = { state: 'synced', checkRunId: null };
    } else {
      const run =
        checkRunId === null
          ? await createCheck(github, repo, intent, revision)
          : intent.desired === 'queued'
            ? null
            : await updateCheck(github, repo, checkRunId, intent, revision);
      checkRunId = run?.id ?? checkRunId;
      outcome =
        run === null || confirmsIntent(github, run, intent)
          ? { state: 'synced', checkRunId }
          : {
              state: 'error',
              error: 'GitHub did not confirm the check state',
              ...(checkRunId ? { checkRunId } : {}),
            };
    }
  } catch (error) {
    if (error instanceof ClaimLostError) throw error;
    outcome = failure(error, checkRunId);
  }
  await recordSyncResult(sql, claim, intent.revisionId, intent.revisionVersion, outcome);
  return outcome.state;
}

/** PR의 반영되지 않은 revision을 오래된 것부터 모두 반영한다. 하나라도 synced가 아니면 false. */
export async function syncPullRequest(deps: ApprovalDeps, claim: Claim): Promise<boolean> {
  const snapshot = await loadSnapshot(deps.sql, claim);
  if (!snapshot || snapshot.pullRequest.blockedReason) return false;
  let allSynced = true;
  for (const revision of await listRevisionsToSync(deps.sql, snapshot.pullRequest.id)) {
    const state = await syncRevision(deps, claim, snapshot.pullRequest, revision);
    allSynced &&= state === 'synced';
  }
  return allSynced;
}
