import { z } from 'zod';

import type { RevisionRecord } from '../manual-approval/schema.ts';
import type { SyncIntent } from '../manual-approval/state.ts';
import { collectPages, type GitHubApi, type RepositoryRef } from './api.ts';

export const CHECK_NAME = 'Review Platform / Manual Approval';
export const MANUAL_ONLY_NOTICE = 'Manual approval only. No automated checks were run.';

const CheckRunSchema = z.object({
  id: z.int().positive(),
  name: z.string(),
  head_sha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  external_id: z.string().nullable(),
  app: z.object({ id: z.int().positive() }).nullable(),
});
export type CheckRun = z.infer<typeof CheckRunSchema>;

const repoPath = (repo: RepositoryRef) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** 이 App이 만든 Check인가. 다른 App · Actions의 Check는 읽지도 고치지도 않는다. */
const ownedBy = (api: GitHubApi) => (run: CheckRun) =>
  run.app?.id === api.config.appId && run.name === CHECK_NAME;

/**
 * 이 App이 head SHA에 만든 `Review Platform / Manual Approval` Check 전부(완료 포함). 응답 유실 뒤 재시도에서
 * external_id로 기존 run을 찾는 데 쓴다 — external_id는 GitHub이 유일성을 보장하지 않는다.
 */
export async function findOwnChecks(
  api: GitHubApi,
  repo: RepositoryRef,
  sha: string,
): Promise<CheckRun[]> {
  const call = (url: string) =>
    api.call([repo.repositoryId], {
      method: 'GET',
      url,
      schema: z
        .object({ check_runs: z.array(CheckRunSchema) })
        .transform((body) => body.check_runs),
    });
  const query = new URLSearchParams({
    check_name: CHECK_NAME,
    app_id: String(api.config.appId),
    filter: 'all',
    per_page: '100',
  });
  const { items, complete } = await collectPages(
    () => call(`${repoPath(repo)}/commits/${sha}/check-runs?${query}`),
    call,
    10,
  );
  if (!complete) throw new Error(`Too many check runs on ${sha} to search`);
  return items.filter(ownedBy(api));
}

type Approval = Pick<RevisionRecord, 'approverLogin' | 'decisionAt'>;

/** 원하는 상태의 Check 본문. open PR의 미승인 상태는 queued뿐이다 — neutral · skipped · success로 보이지 않는다. */
function checkState(intent: SyncIntent, approval: Approval) {
  switch (intent.desired) {
    case 'queued':
      return {
        status: 'queued',
        output: {
          title: 'Waiting for manual approval',
          summary: `${MANUAL_ONLY_NOTICE}\n\nThis head commit has not been approved on Review Platform yet.`,
        },
      };
    case 'success':
      return {
        status: 'completed',
        conclusion: 'success',
        completed_at: new Date().toISOString(),
        output: {
          title: 'Manually approved',
          summary:
            `${MANUAL_ONLY_NOTICE}\n\nApproved by @${approval.approverLogin} at ` +
            `${approval.decisionAt?.toISOString()} for head commit ${intent.headSha}.`,
        },
      };
    case 'cancelled':
      return {
        status: 'completed',
        conclusion: 'cancelled',
        completed_at: new Date().toISOString(),
        output: {
          title: 'No longer current',
          summary: `${MANUAL_ONLY_NOTICE}\n\nThis commit is no longer the head of an open pull request, so it will not be approved here.`,
        },
      };
  }
}

/** Check를 새로 만든다. `details_url`은 서버 설정의 공개 URL + PR 상세 경로뿐이다. */
export async function createCheck(
  api: GitHubApi,
  repo: RepositoryRef,
  intent: SyncIntent,
  approval: Approval,
): Promise<CheckRun> {
  const { data } = await api.call([repo.repositoryId], {
    method: 'POST',
    url: `${repoPath(repo)}/check-runs`,
    schema: CheckRunSchema,
    body: {
      name: CHECK_NAME,
      head_sha: intent.headSha,
      external_id: intent.externalId,
      details_url: `${api.config.publicBaseUrl}/pulls/${intent.key.repositoryId}/${intent.key.number}`,
      ...checkState(intent, approval),
    },
  });
  return data;
}

/** 이 App의 Check 하나를 원하는 상태로 바꾼다. */
export async function updateCheck(
  api: GitHubApi,
  repo: RepositoryRef,
  checkRunId: number,
  intent: SyncIntent,
  approval: Approval,
): Promise<CheckRun> {
  const { data } = await api.call([repo.repositoryId], {
    method: 'PATCH',
    url: `${repoPath(repo)}/check-runs/${checkRunId}`,
    schema: CheckRunSchema,
    body: checkState(intent, approval),
  });
  return data;
}

/** GitHub이 돌려준 run이 이 App · 이 SHA · 원하는 상태인지. 아니면 반영을 확인하지 못한 것이다. */
export function confirmsIntent(api: GitHubApi, run: CheckRun, intent: SyncIntent): boolean {
  if (!ownedBy(api)(run) || run.head_sha !== intent.headSha) return false;
  if (intent.desired === 'queued') return run.status !== 'completed';
  return run.status === 'completed' && run.conclusion === intent.desired;
}
