import { z } from 'zod';

import { type ObservedPullRequest, ObservedPullRequestSchema } from '../manual-approval/schema.ts';
import { collectPages, type GitHubApi, type RepositoryRef } from './api.ts';

const PullSchema = z.object({
  number: z.int().positive(),
  state: z.enum(['open', 'closed']),
  merged_at: z.string().nullable(),
  title: z.string(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  head: z.object({ sha: z.string() }),
  base: z.object({
    repo: z.object({
      id: z.int().positive(),
      name: z.string(),
      owner: z.object({ login: z.string() }),
    }),
  }),
});
type Pull = z.infer<typeof PullSchema>;

/** 응답 PR의 base 저장소가 요청한 저장소가 아니다(이전 · 이름 재사용 등). 처리하지 않는다. */
export class RepositoryMismatchError extends Error {
  override name = 'RepositoryMismatchError';
}

/**
 * GitHub PR을 관측값으로 바꾼다. HEAD는 `head.sha`(PR head commit)만 쓴다 — Actions의 test merge commit이 아니다.
 * 저장소 이름은 응답의 base 저장소에서 가져와 이름 변경을 따라간다. fork PR도 base 저장소 기준이다.
 */
function toObserved(pull: Pull, repositoryId: number, installationId: number): ObservedPullRequest {
  if (pull.base.repo.id !== repositoryId) {
    throw new RepositoryMismatchError(
      `PR #${pull.number} does not belong to repository ${repositoryId}`,
    );
  }
  return ObservedPullRequestSchema.parse({
    repositoryId,
    number: pull.number,
    installationId,
    owner: pull.base.repo.owner.login,
    name: pull.base.repo.name,
    title: pull.title,
    authorLogin: pull.user?.login ?? 'ghost',
    htmlUrl: pull.html_url,
    headSha: pull.head.sha,
    state: pull.state === 'open' ? 'open' : pull.merged_at ? 'merged' : 'closed',
  });
}

const repoPath = (repo: RepositoryRef) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** 현재 PR을 GitHub에서 다시 읽는다. webhook payload 대신 이것만 DB에 반영한다. */
export async function getPullRequest(
  api: GitHubApi,
  repo: RepositoryRef,
  number: number,
): Promise<ObservedPullRequest> {
  const { data } = await api.call([repo.repositoryId], {
    method: 'GET',
    url: `${repoPath(repo)}/pulls/${number}`,
    schema: PullSchema,
  });
  return toObserved(data, repo.repositoryId, api.config.installationId);
}

/**
 * 같은 head SHA를 가진 이 저장소의 open PR 번호들. 모든 페이지를 읽지 못했으면 `complete: false` —
 * 호출자는 그때 승인하지 않는다. Check는 commit 단위라 둘 이상이면 한쪽 승인이 다른 쪽에 이월된다.
 */
export async function openPullsWithHead(
  api: GitHubApi,
  repo: RepositoryRef,
  sha: string,
): Promise<{ numbers: number[]; complete: boolean }> {
  const call = (url: string) =>
    api.call([repo.repositoryId], { method: 'GET', url, schema: z.array(PullSchema) });
  const { items, complete } = await collectPages(
    () => call(`${repoPath(repo)}/commits/${sha}/pulls?per_page=100`),
    call,
    10,
  );
  const numbers = items
    .filter(
      (pull) =>
        pull.state === 'open' && pull.base.repo.id === repo.repositoryId && pull.head.sha === sha,
    )
    .map((pull) => pull.number);
  return { numbers, complete };
}

/** 저장소의 open PR 한 페이지. 재동기화 bootstrap이 페이지 단위로 이어 간다. */
export async function listOpenPulls(
  api: GitHubApi,
  repo: RepositoryRef,
  page: number,
): Promise<{ pulls: ObservedPullRequest[]; hasNext: boolean }> {
  const { data, nextUrl } = await api.call([repo.repositoryId], {
    method: 'GET',
    url: `${repoPath(repo)}/pulls?state=open&sort=created&direction=asc&per_page=50&page=${page}`,
    schema: z.array(PullSchema),
  });
  return {
    pulls: data.map((pull) => toObserved(pull, repo.repositoryId, api.config.installationId)),
    hasNext: nextUrl !== null,
  };
}

const InstallationRepositoriesSchema = z.object({
  repositories: z.array(
    z.object({ id: z.int().positive(), name: z.string(), owner: z.object({ login: z.string() }) }),
  ),
});

/**
 * 허용 목록의 저장소 중 installation이 실제로 접근할 수 있는 것. 허용 저장소 하나라도 installation에 없으면
 * token 발급이 실패한다(fail closed).
 */
export async function listInstalledRepositories(api: GitHubApi): Promise<RepositoryRef[]> {
  const ids = [...api.config.allowedRepositoryIds];
  const { data } = await api.call(ids, {
    method: 'GET',
    url: '/installation/repositories?per_page=100',
    schema: InstallationRepositoriesSchema,
  });
  return data.repositories
    .filter((repository) => api.config.allowedRepositoryIds.has(repository.id))
    .map((repository) => ({
      repositoryId: repository.id,
      owner: repository.owner.login,
      name: repository.name,
    }))
    .sort((a, b) => a.repositoryId - b.repositoryId);
}
