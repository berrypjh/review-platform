import type {
  ApproveInput,
  ObservedPullRequest,
  PullRequestKey,
  PullRequestRecord,
  RevisionRecord,
} from './schema.ts';

/** PR과 그 active revision. active revision은 항상 가장 큰 generation이다. */
export type Snapshot = { pullRequest: PullRequestRecord; revision: RevisionRecord | null };

/**
 * GitHub에서 다시 읽은 PR을 반영할 때 새 승인 단위(revision)를 열어야 하는지 정한다.
 * open이면서 HEAD가 바뀌었거나, closed → open이 관측됐거나, 아직 revision이 없을 때만 연다.
 * 같은 관측을 반복해도 열지 않고, A → B → A도 새 단위로 본다 — 과거 A의 승인을 되살리지 않는다.
 */
export function needsNewRevision(current: Snapshot | null, observed: ObservedPullRequest): boolean {
  if (observed.state !== 'open') return false;
  if (!current || !current.revision) return true;
  return current.pullRequest.state !== 'open' || current.pullRequest.headSha !== observed.headSha;
}

/**
 * 관측 뒤 지금의 active revision이 현재가 아니게 되는가(새 revision이 열리거나 PR이 닫힘).
 * 아직 승인되지 않은 대기 revision만 해당한다 — 그 commit의 status를 닫는다(cancelled 의도). 승인 이력은 그대로 둔다.
 */
export function becomesObsolete(current: Snapshot | null, observed: ObservedPullRequest): boolean {
  const revision = current?.revision;
  if (!revision || revision.decision !== 'pending' || revision.desiredCheckState !== 'queued') {
    return false;
  }
  return observed.state !== 'open' || needsNewRevision(current, observed);
}

/** 새 revision의 generation. PR마다 1부터 하나씩 늘어난다. */
export const nextGeneration = (current: Snapshot | null) =>
  (current?.revision?.generation ?? 0) + 1;

/** 관측 결과가 저장된 PR과 다른가. 같으면 version을 올리지 않는다. */
export function pullRequestChanged(
  stored: PullRequestRecord,
  observed: ObservedPullRequest,
): boolean {
  return (
    stored.installationId !== observed.installationId ||
    stored.owner !== observed.owner ||
    stored.name !== observed.name ||
    stored.title !== observed.title ||
    stored.authorLogin !== observed.authorLogin ||
    stored.htmlUrl !== observed.htmlUrl ||
    stored.headSha !== observed.headSha ||
    stored.state !== observed.state
  );
}

export type ApprovalRejection =
  'not-found' | 'blocked' | 'not-open' | 'no-revision' | 'revision-changed' | 'head-changed';

export type ApprovalCheck =
  | { kind: 'approve'; revision: RevisionRecord & { decision: 'pending' } }
  | { kind: 'already-approved'; revision: RevisionRecord & { decision: 'approved' } }
  | { kind: 'rejected'; reason: ApprovalRejection };

/**
 * 승인 요청을 저장된 상태와 대조한다. 화면이 보던 HEAD · generation이 현재와 같고 PR이 open일 때만 승인한다.
 * 같은 revision이 이미 승인됐으면 최초 결정을 그대로 둔다.
 */
export function checkApproval(current: Snapshot | null, input: ApproveInput): ApprovalCheck {
  if (!current) return { kind: 'rejected', reason: 'not-found' };
  const { pullRequest, revision } = current;
  if (pullRequest.blockedReason) return { kind: 'rejected', reason: 'blocked' };
  if (pullRequest.state !== 'open') return { kind: 'rejected', reason: 'not-open' };
  if (!revision) return { kind: 'rejected', reason: 'no-revision' };
  if (revision.generation !== input.expectedRevision) {
    return { kind: 'rejected', reason: 'revision-changed' };
  }
  if (revision.headSha !== input.expectedHeadSha || pullRequest.headSha !== input.expectedHeadSha) {
    return { kind: 'rejected', reason: 'head-changed' };
  }
  if (revision.decision === 'approved') return { kind: 'already-approved', revision };
  return { kind: 'approve', revision };
}

/** 화면이 보여 줄 승인 상태. `approved`는 승인 의사와 GitHub 반영이 모두 확인됐을 때뿐이다. */
export type ApprovalStatus =
  | 'pending'
  | 'syncing'
  | 'sync-unknown'
  | 'sync-error'
  | 'approved'
  | 'closed'
  | 'merged'
  | 'blocked';

/** 승인 상태를 한 곳에서 계산한다. 화면 · API가 다시 계산하지 않는다. */
export function approvalStatus({ pullRequest, revision }: Snapshot): ApprovalStatus {
  if (pullRequest.state === 'merged') return 'merged';
  if (pullRequest.state === 'closed') return 'closed';
  if (pullRequest.blockedReason) return 'blocked';
  if (!revision || revision.decision === 'pending') return 'pending';
  if (revision.syncState === 'synced') return 'approved';
  if (revision.syncState === 'error') return 'sync-error';
  // 응답 유실 · timeout — GitHub에 반영됐는지 모른다. 반영 중(pending)과 구분해 안내한다
  if (revision.syncState === 'unknown') return 'sync-unknown';
  return 'syncing';
}

/** 승인 버튼을 보여도 되는가. closed · merged · 차단 · 이미 승인이면 막는다. */
export const canApprove = (current: Snapshot) =>
  approvalStatus(current) === 'pending' && current.revision !== null;

/** GitHub에 반영해야 할 상태. 이미 synced면 null이다. GitHub adapter가 이것을 받아 commit status를 쓴다. */
export type SyncIntent = {
  key: PullRequestKey;
  revisionId: number;
  revisionVersion: number;
  generation: number;
  headSha: string;
  desired: RevisionRecord['desiredCheckState'];
};

/** revision 하나의 반영 의도. active가 아닌(cancelled로 닫을) revision도 여기로 들어온다. */
export function revisionSyncIntent(
  pullRequest: PullRequestRecord,
  revision: RevisionRecord,
): SyncIntent | null {
  if (revision.syncState === 'synced') return null;
  return {
    key: { repositoryId: pullRequest.repositoryId, number: pullRequest.number },
    revisionId: revision.id,
    revisionVersion: revision.version,
    generation: revision.generation,
    headSha: revision.headSha,
    desired: revision.desiredCheckState,
  };
}

/** active revision의 반영 의도. */
export const syncIntent = ({ pullRequest, revision }: Snapshot) =>
  revision ? revisionSyncIntent(pullRequest, revision) : null;
