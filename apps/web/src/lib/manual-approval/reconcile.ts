import type { RepositoryRef } from '../github/api.ts';
import { remainingMs } from '../github/http.ts';
import { getPullRequest, listInstalledRepositories, listOpenPulls } from '../github/pulls.ts';
import {
  applyObservation,
  clearRepositoryBlock,
  listUnsynced,
  loadSnapshot,
  releaseClaim,
} from './repository.ts';
import type { ObservedPullRequest, PullRequestKey } from './schema.ts';
import { acquireClaim, type ApprovalDeps, repositoryOf, syncPullRequest } from './sync.ts';

export type PullOutcome = 'synced' | 'not-synced' | 'busy' | 'not-found' | 'blocked';

/** deadline이 이만큼 남으면 다음 PR을 시작하지 않고 continuation을 돌려준다. */
const RESERVE_MS = 5_000;
const UNSYNCED_BATCH = 10;

/**
 * PR 하나를 복구한다. GitHub에서 다시 읽은 값(`observed`가 있으면 그것)을 반영하고 반영되지 않은 commit status를 맞춘다.
 * DB에 없는 PR은 `repository`가 있어야 한다(bootstrap).
 */
export async function reconcilePullRequest(
  deps: ApprovalDeps,
  key: PullRequestKey,
  source: { repository?: RepositoryRef; observed?: ObservedPullRequest } = {},
): Promise<PullOutcome> {
  if (!deps.github.config.allowedRepositoryIds.has(key.repositoryId)) return 'not-found';
  const stored = await loadSnapshot(deps.sql, key);
  if (stored?.pullRequest.blockedReason) return 'blocked';
  const repository = stored ? repositoryOf(stored.pullRequest) : source.repository;
  if (!repository) return 'not-found';
  const claim = await acquireClaim(deps.sql, key, 1_000);
  if (!claim) return 'busy';
  try {
    const observed = source.observed ?? (await getPullRequest(deps.github, repository, key.number));
    await applyObservation(deps.sql, claim, observed);
    return (await syncPullRequest(deps, claim)) ? 'synced' : 'not-synced';
  } finally {
    await releaseClaim(deps.sql, claim);
  }
}

export type ReconcileReport = {
  processed: number;
  notSynced: PullRequestKey[];
  /** 다음 호출에 넘길 continuation. null이면 bootstrap까지 끝났다. */
  cursor: string | null;
};

const CURSOR = /^(\d+):(\d+)$/;

/**
 * 재동기화 batch. 먼저 DB에서 반영되지 않은 PR을, 이어서 허용 저장소의 open PR을 페이지 단위로 훑는다(bootstrap).
 * deadline이 가까우면 `cursor`(저장소 순번:페이지)를 돌려주고 멈춘다. 자동 반복은 없다 — 운영자가 다시 호출한다.
 */
export async function reconcile(
  deps: ApprovalDeps,
  cursor: string | null,
): Promise<ReconcileReport> {
  const report: ReconcileReport = { processed: 0, notSynced: [], cursor: null };
  const record = (key: PullRequestKey, outcome: PullOutcome) => {
    report.processed++;
    if (outcome !== 'synced') report.notSynced.push(key);
  };
  const timeLeft = () => remainingMs(deps.github.deadline) > RESERVE_MS;

  if (cursor === null) {
    for (const key of await listUnsynced(deps.sql, UNSYNCED_BATCH)) {
      if (!timeLeft()) return { ...report, cursor: '0:1' };
      record(key, await reconcilePullRequest(deps, key));
    }
  }
  const [, startIndex = '0', startPage = '1'] = cursor?.match(CURSOR) ?? [];
  const repositories = await listInstalledRepositories(deps.github);
  for (const [index, repository] of repositories.entries()) {
    if (index < Number(startIndex)) continue;
    await clearRepositoryBlock(deps.sql, repository.repositoryId);
    for (let page = index === Number(startIndex) ? Number(startPage) : 1; ; page++) {
      if (!timeLeft()) return { ...report, cursor: `${index}:${page}` };
      const { pulls, hasNext } = await listOpenPulls(deps.github, repository, page);
      for (const observed of pulls) {
        // 페이지 중간에 멈추면 같은 페이지부터 다시 한다. 이미 처리한 PR은 바뀐 것이 없어 GitHub 쓰기가 없다.
        if (!timeLeft()) return { ...report, cursor: `${index}:${page}` };
        const key = { repositoryId: observed.repositoryId, number: observed.number };
        record(key, await reconcilePullRequest(deps, key, { repository, observed }));
      }
      if (!hasNext) break;
    }
  }
  return report;
}

/** 운영자가 넘긴 cursor가 형식에 맞는지. 맞지 않으면 처음부터가 아니라 거부한다. */
export const isValidCursor = (cursor: string) => CURSOR.test(cursor);
