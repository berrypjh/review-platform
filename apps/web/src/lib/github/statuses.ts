import { z } from 'zod';

import type { RevisionRecord } from '../manual-approval/schema.ts';
import type { SyncIntent } from '../manual-approval/state.ts';
import type { GitHubApi, RepositoryRef } from './api.ts';

export const STATUS_CONTEXT = 'Review Platform / Manual Approval';
export const MANUAL_ONLY_NOTICE = 'Manual approval only. No automated checks were run.';

/** GitHub commit status의 description 상한. */
const DESCRIPTION_LIMIT = 140;

const CommitStatusSchema = z.object({
  id: z.int().positive(),
  state: z.enum(['error', 'failure', 'pending', 'success']),
  context: z.string(),
  description: z.string().nullable(),
  target_url: z.string().nullable(),
});
export type CommitStatus = z.infer<typeof CommitStatusSchema>;

const repoPath = (repo: RepositoryRef) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

type Approval = Pick<RevisionRecord, 'approverLogin'>;

const STATE: Record<SyncIntent['desired'], CommitStatus['state']> = {
  queued: 'pending',
  success: 'success',
  cancelled: 'error',
};

/** 의도별 description. 미승인 상태는 pending뿐이다 — success로 보이지 않는다. */
function description(intent: SyncIntent, approval: Approval): string {
  switch (intent.desired) {
    case 'queued':
      return `Waiting for manual approval. ${MANUAL_ONLY_NOTICE}`;
    case 'success':
      return `Approved by @${approval.approverLogin}. ${MANUAL_ONLY_NOTICE}`;
    case 'cancelled':
      return 'No longer the head of an open pull request.';
  }
}

/**
 * head SHA에 이 context의 status를 쓴다. 같은 context는 마지막 값이 보이므로 같은 의도를 다시 보내도 된다.
 * `target_url`은 서버 설정의 공개 URL + PR 상세 경로뿐이다.
 */
export async function setStatus(
  api: GitHubApi,
  repo: RepositoryRef,
  intent: SyncIntent,
  approval: Approval,
): Promise<CommitStatus> {
  const { data } = await api.call([repo.repositoryId], {
    method: 'POST',
    url: `${repoPath(repo)}/statuses/${intent.headSha}`,
    schema: CommitStatusSchema,
    body: {
      state: STATE[intent.desired],
      context: STATUS_CONTEXT,
      description: description(intent, approval).slice(0, DESCRIPTION_LIMIT),
      target_url: `${api.config.publicBaseUrl}/pulls/${intent.key.repositoryId}/${intent.key.number}`,
    },
  });
  return data;
}

/** GitHub이 돌려준 status가 이 context · 원하는 상태인지. 아니면 반영을 확인하지 못한 것이다. */
export const confirmsIntent = (status: CommitStatus, intent: SyncIntent): boolean =>
  status.context === STATUS_CONTEXT && status.state === STATE[intent.desired];
