import type { z } from 'zod';

import type { ManualApprovalConfig } from '../manual-approval/config.ts';
import { createInstallationToken } from './app-auth.ts';
import { type Deadline, githubRequest, type GitHubResponse, type Transport } from './http.ts';

/** 저장소 identity. 이름은 표시 · URL용이고, 판정은 numeric ID로 한다. */
export type RepositoryRef = { repositoryId: number; owner: string; name: string };

/**
 * 한 요청(webhook · 승인 · 재동기화) 동안 쓰는 GitHub 접근. installation token은 저장소 범위별로 이 객체 안에만 둔다 —
 * 요청이 끝나면 버려지므로 만료 전에 항상 새로 받는 셈이고, DB · 로그 · 응답에 남지 않는다.
 */
export type GitHubApi = {
  readonly config: ManualApprovalConfig;
  readonly deadline: Deadline;
  call<T>(
    repositoryIds: number[],
    request: {
      method: 'GET' | 'POST' | 'PATCH';
      url: string;
      schema: z.ZodType<T>;
      body?: unknown;
    },
  ): Promise<GitHubResponse<T>>;
};

export function createGitHubApi(
  transport: Transport,
  config: ManualApprovalConfig,
  deadline: Deadline,
): GitHubApi {
  const tokens = new Map<string, Promise<string>>();
  const tokenFor = (repositoryIds: number[]) => {
    const key = [...repositoryIds].sort((a, b) => a - b).join(',');
    let token = tokens.get(key);
    if (!token) {
      token = createInstallationToken(transport, config, repositoryIds, deadline);
      tokens.set(key, token);
    }
    return token;
  };
  return {
    config,
    deadline,
    async call(repositoryIds, request) {
      const token = await tokenFor(repositoryIds);
      return githubRequest(transport, { ...request, token, deadline });
    },
  };
}

/** Link header를 따라 최대 `maxPages`까지 모은다. 다 읽지 못했으면 `complete: false`. */
export async function collectPages<T>(
  first: () => Promise<GitHubResponse<T[]>>,
  next: (url: string) => Promise<GitHubResponse<T[]>>,
  maxPages: number,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let page = await first();
  for (let count = 1; ; count++) {
    items.push(...page.data);
    if (!page.nextUrl) return { items, complete: true };
    if (count >= maxPages) return { items, complete: false };
    page = await next(page.nextUrl);
  }
}
