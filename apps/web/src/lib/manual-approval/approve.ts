import { getPullRequest, openPullsWithHead } from '../github/pulls.ts';
import { applyObservation, loadSnapshot, recordApproval, releaseClaim } from './repository.ts';
import type { Approver, ApproveInput, PullRequestKey } from './schema.ts';
import { type ApprovalRejection, approvalStatus, checkApproval, type Snapshot } from './state.ts';
import { acquireClaim, type ApprovalDeps, repositoryOf, syncPullRequest } from './sync.ts';

export type ApproveOutcome =
  /** 승인 기록과 GitHub success가 모두 확인됐고, 그 사이 HEAD가 바뀌지 않았다. */
  | { kind: 'approved'; snapshot: Snapshot }
  /** 승인 의사는 기록됐지만 GitHub 반영을 확인하지 못했다. Approved가 아니다. */
  | { kind: 'not-confirmed'; snapshot: Snapshot }
  | {
      kind: 'conflict';
      reason:
        ApprovalRejection | 'shared-head' | 'shared-head-unknown' | 'head-changed-after-approval';
    }
  | { kind: 'forbidden-repository' }
  | { kind: 'busy' };

/**
 * 승인 흐름. 세션 · 운영자 · CSRF 확인은 호출자(route)가 먼저 한다.
 * 1) PR claim 2) GitHub에서 open · HEAD 재조회 → DB 반영 3) 화면이 보던 HEAD · revision과 다르면 conflict
 * 4) 승인 의사를 먼저 commit 5) 같은 SHA의 Check를 success로 6) PR을 다시 읽어 HEAD가 그대로인지 확인.
 * DB와 GitHub은 한 transaction이 아니다 — 중간 실패는 sync 상태로 남고 재동기화가 이어 간다.
 */
export async function approvePullRequest(
  deps: ApprovalDeps,
  key: PullRequestKey,
  input: ApproveInput,
  approver: Approver,
): Promise<ApproveOutcome> {
  if (!deps.github.config.allowedRepositoryIds.has(key.repositoryId)) {
    return { kind: 'forbidden-repository' };
  }
  const stored = await loadSnapshot(deps.sql, key);
  if (!stored) return { kind: 'conflict', reason: 'not-found' };
  const claim = await acquireClaim(deps.sql, key, 2_000);
  if (!claim) return { kind: 'busy' };
  try {
    const repo = repositoryOf(stored.pullRequest);
    const current = await applyObservation(
      deps.sql,
      claim,
      await getPullRequest(deps.github, repo, key.number),
    );
    const check = checkApproval(current, input);
    if (check.kind === 'rejected') {
      await syncPullRequest(deps, claim);
      return { kind: 'conflict', reason: check.reason };
    }
    const { numbers, complete } = await openPullsWithHead(deps.github, repo, input.expectedHeadSha);
    if (!complete) return { kind: 'conflict', reason: 'shared-head-unknown' };
    if (numbers.some((number) => number !== key.number))
      return { kind: 'conflict', reason: 'shared-head' };

    if (check.kind === 'approve') {
      const recorded = await recordApproval(deps.sql, claim, input, approver);
      if (recorded.kind === 'rejected') return { kind: 'conflict', reason: recorded.reason };
    }
    await syncPullRequest(deps, claim);

    const after = await applyObservation(
      deps.sql,
      claim,
      await getPullRequest(deps.github, repo, key.number),
    );
    if (after.revision?.id !== check.revision.id) {
      await syncPullRequest(deps, claim);
      return { kind: 'conflict', reason: 'head-changed-after-approval' };
    }
    return approvalStatus(after) === 'approved'
      ? { kind: 'approved', snapshot: after }
      : { kind: 'not-confirmed', snapshot: after };
  } finally {
    await releaseClaim(deps.sql, claim);
  }
}
