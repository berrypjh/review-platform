import type { Metadata } from 'next';
import { connection } from 'next/server';

import {
  LoadFailed,
  NotConfigured,
  OperatorBar,
  SignedOut,
} from '@/components/review/approval-gate';
import { SyncPullRequestsButton } from '@/components/review/pull-request-list-actions';
import { PullRequestsTable } from '@/components/review/pull-requests-table';
import { listPullRequests } from '@/lib/manual-approval/repository';
import { loadViewer } from '@/lib/manual-approval/viewer';

export const metadata: Metadata = { title: 'Pull requests', robots: { index: false } };

/** 목록에 보일 PR 수 상한. 오래된 닫힌 PR은 뒤로 밀린다. */
const LIST_LIMIT = 200;

async function load() {
  try {
    const viewer = await loadViewer();
    if (viewer.kind !== 'operator') return viewer;
    const snapshots = await listPullRequests(
      viewer.sql,
      [...viewer.config.allowedRepositoryIds],
      LIST_LIMIT,
    );
    return { kind: 'ok' as const, viewer, snapshots };
  } catch (error) {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : 'Failed to load pull requests',
    );
    return { kind: 'error' as const };
  }
}

/**
 * Pull requests 화면. 운영자 세션을 서버에서 확인한 뒤에만 DB를 읽는다.
 * 세션 cookie를 읽으므로 요청마다 렌더링되고, 사용자별 결과가 캐시에 섞이지 않는다.
 */
export default async function PullsPage() {
  await connection();
  const page = await load();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pull requests</h1>
          <p className="text-sm text-muted-foreground">
            Manual approval for the GitHub check “Review Platform / Manual Approval”. No automated
            checks are run.
          </p>
        </div>
        {page.kind === 'ok' && (
          <OperatorBar login={page.viewer.operator.login} csrfToken={page.viewer.csrfToken} />
        )}
      </div>
      {page.kind === 'not-configured' && <NotConfigured />}
      {page.kind === 'signed-out' && <SignedOut returnTo="/pulls" />}
      {page.kind === 'error' && <LoadFailed what="pull requests" />}
      {page.kind === 'ok' && (
        <>
          <SyncPullRequestsButton csrfToken={page.viewer.csrfToken} />
          {page.snapshots.length > 0 ? (
            <PullRequestsTable snapshots={page.snapshots} />
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No pull requests yet. They appear when a pull request is opened in an allowed
              repository, or after Sync PRs loads the open ones.
            </p>
          )}
        </>
      )}
    </div>
  );
}
