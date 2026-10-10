'use client';

import { RefreshCw, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { shortSha } from '@/lib/format';

import {
  ActionMessage,
  type ActionOutcome,
  type PostResult,
  postForm,
  useAction,
} from './action-feedback';

const NEW_COMMIT =
  'A new commit was pushed to this pull request. Nothing was approved. Review the new head commit shown above, then approve again.';

const CONFLICTS: Record<string, string> = {
  'revision-changed': NEW_COMMIT,
  'head-changed': NEW_COMMIT,
  'head-changed-after-approval':
    'A new commit was pushed while approving. Only the previous commit was approved. Review the new head commit, then approve again.',
  'shared-head':
    'Another open pull request has the same head commit. Approval is blocked while more than one open pull request uses it.',
  'shared-head-unknown':
    'Could not check every pull request that uses this head commit. Nothing was approved. Try again.',
  'not-open': 'This pull request is no longer open. Nothing was approved.',
  blocked: 'GitHub App access to this repository is suspended or removed. Nothing was approved.',
};

const NOT_CONFIRMED =
  'The approval is recorded, but GitHub has not confirmed the check. It is not approved on GitHub yet. Use Retry sync.';

/** 승인 응답을 안내로. 200 `approved`만 성공이다 — 그 밖에는 승인됐다고 말하지 않는다. */
function approveOutcome({ status, body }: PostResult, headSha: string): ActionOutcome {
  if (status === 200 && body['result'] === 'approved') {
    return {
      tone: 'success',
      message: `Approved. GitHub confirmed the check for head commit ${shortSha(headSha)}.`,
    };
  }
  if (status === 409) {
    return {
      tone: 'error',
      message:
        CONFLICTS[String(body['reason'])] ?? 'The pull request changed. Nothing was approved.',
    };
  }
  if (status === 502 && body['result'] === 'not-confirmed')
    return { tone: 'error', message: NOT_CONFIRMED };
  return { tone: 'error', message: commonFailure(status) };
}

function syncOutcome({ status, body }: PostResult): ActionOutcome {
  if (status === 200 && body['result'] === 'synced') {
    return { tone: 'success', message: 'Sync finished. GitHub matches the recorded state.' };
  }
  if (status === 200 && body['result'] === 'not-synced') {
    return {
      tone: 'error',
      message: 'Sync did not finish. GitHub has not confirmed the check. Try again later.',
    };
  }
  if (status === 200 && body['result'] === 'blocked') {
    return {
      tone: 'error',
      message: 'GitHub App access to this repository is suspended or removed.',
    };
  }
  return { tone: 'error', message: commonFailure(status) };
}

/** 인증 · 혼잡 · 그 밖의 실패. 화면 위쪽 상태는 서버가 다시 읽은 실제 상태다. */
export function commonFailure(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You are not allowed to do this. Reload the page and try again.';
  if (status === 404) return 'This pull request is not registered. Use Sync PRs on the list first.';
  if (status === 503)
    return 'Another update for this pull request is in progress, or the server is not configured. Try again in a moment.';
  return 'The request failed. Nothing new is confirmed on GitHub. The state shown above is the current recorded state.';
}

type Props = {
  repositoryId: number;
  number: number;
  headSha: string;
  revision: number;
  csrfToken: string;
  canApprove: boolean;
  canRetrySync: boolean;
};

/**
 * 상세 화면의 승인 · Retry sync. 화면에 보인 HEAD SHA와 revision을 그대로 보낸다 — 서버가 현재 값과 다르면 409로 거부한다.
 * 버튼이 사라져도(승인 뒤) 이 컴포넌트는 남아 결과 안내를 유지한다.
 */
export function ApprovalActions({
  repositoryId,
  number,
  headSha,
  revision,
  csrfToken,
  canApprove,
  canRetrySync,
}: Props) {
  const { run, pending, outcome, messageRef } = useAction();
  const base = `/api/pulls/${repositoryId}/${number}`;

  const approve = () =>
    run(async () =>
      approveOutcome(
        await postForm(`${base}/approve`, {
          csrf: csrfToken,
          expectedHeadSha: headSha,
          expectedRevision: String(revision),
        }),
        headSha,
      ),
    );
  const retrySync = () =>
    run(async () =>
      syncOutcome(
        await postForm('/api/github/reconcile', {
          csrf: csrfToken,
          repositoryId: String(repositoryId),
          number: String(number),
        }),
      ),
    );

  return (
    <div className="space-y-4">
      {(canApprove || canRetrySync) && (
        <div className="flex flex-wrap gap-3">
          {canApprove && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void approve();
              }}
            >
              <Button type="submit" disabled={pending} aria-busy={pending}>
                <ShieldCheck aria-hidden="true" />
                {pending ? 'Approving…' : `Approve ${shortSha(headSha)}`}
              </Button>
            </form>
          )}
          {canRetrySync && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void retrySync();
              }}
            >
              <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
                <RefreshCw aria-hidden="true" />
                {pending ? 'Syncing…' : 'Retry sync'}
              </Button>
            </form>
          )}
        </div>
      )}
      <ActionMessage outcome={outcome} messageRef={messageRef} />
    </div>
  );
}
