import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { ApprovalActions } from '@/components/review/approval-actions';
import {
  LoadFailed,
  NotConfigured,
  OperatorBar,
  SignedOut,
} from '@/components/review/approval-gate';
import { DefinitionList } from '@/components/review/definition-list';
import { ExternalLink } from '@/components/review/external-link';
import { RevisionHistory } from '@/components/review/revision-history';
import { StatusBadge } from '@/components/review/status-badge';
import { Separator } from '@/components/ui/separator';
import { formatTimestamp } from '@/lib/format';
import {
  APPROVAL_STATUS_DISPLAY,
  APPROVAL_STATUS_NOTICE,
  PULL_REQUEST_STATE_LABEL,
  SYNC_STATE_LABEL,
} from '@/lib/manual-approval/display';
import { listRevisions, loadSnapshot } from '@/lib/manual-approval/repository';
import { PullRequestKeySchema } from '@/lib/manual-approval/schema';
import { approvalStatus, canApprove, type Snapshot } from '@/lib/manual-approval/state';
import { loadViewer } from '@/lib/manual-approval/viewer';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ repositoryId: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  return { title: `Pull request #${number}`, robots: { index: false } };
}

async function load(repositoryId: number, number: number) {
  try {
    const viewer = await loadViewer();
    if (viewer.kind !== 'operator') return viewer;
    if (!viewer.config.allowedRepositoryIds.has(repositoryId))
      return { kind: 'not-found' as const };
    const snapshot = await loadSnapshot(viewer.sql, { repositoryId, number });
    if (!snapshot) return { kind: 'not-found' as const };
    const revisions = await listRevisions(viewer.sql, snapshot.pullRequest.id);
    return { kind: 'ok' as const, viewer, snapshot, revisions };
  } catch (error) {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : 'Failed to load pull request',
    );
    return { kind: 'error' as const };
  }
}

function Summary({ snapshot }: { snapshot: Snapshot }) {
  const { pullRequest, revision } = snapshot;
  const approved = revision?.decision === 'approved' ? revision : null;
  return (
    <DefinitionList
      className="sm:grid-cols-2 xl:grid-cols-3"
      fields={[
        { term: 'Repository', value: `${pullRequest.owner}/${pullRequest.name}` },
        { term: 'State', value: PULL_REQUEST_STATE_LABEL[pullRequest.state] },
        { term: 'Author', value: `@${pullRequest.authorLogin}` },
        { term: 'Head SHA', value: pullRequest.headSha, mono: true },
        { term: 'Revision', value: revision ? String(revision.generation) : 'None' },
        { term: 'GitHub check', value: revision ? SYNC_STATE_LABEL[revision.syncState] : 'None' },
        { term: 'Approved by', value: approved ? `@${approved.approverLogin}` : 'Not approved' },
        {
          term: 'Approved at',
          value: approved ? formatTimestamp(approved.decisionAt.toISOString()) : 'Not approved',
        },
      ]}
    />
  );
}

/**
 * PR 상세 · 수동 승인. 승인 버튼은 현재 HEAD · revision을 그대로 서버에 보낸다.
 * Approved는 서버가 DB 기록과 GitHub 반영을 모두 확인한 상태(`approvalStatus`)일 때만 보인다.
 */
export default async function PullRequestPage({ params }: Props) {
  await connection();
  const raw = await params;
  const key = PullRequestKeySchema.safeParse({
    repositoryId: Number(raw.repositoryId),
    number: Number(raw.number),
  });
  if (!key.success) notFound();
  const page = await load(key.data.repositoryId, key.data.number);
  if (page.kind === 'not-found') notFound();

  const backLink = (
    <Link
      href="/pulls"
      className={cn('text-sm text-muted-foreground underline-offset-4 hover:underline', focusRing)}
    >
      ← All pull requests
    </Link>
  );
  if (page.kind !== 'ok') {
    return (
      <div className="space-y-6">
        {backLink}
        <h1 className="text-2xl font-semibold tracking-tight">Pull request #{key.data.number}</h1>
        {page.kind === 'not-configured' && <NotConfigured />}
        {page.kind === 'signed-out' && (
          <SignedOut returnTo={`/pulls/${key.data.repositoryId}/${key.data.number}`} />
        )}
        {page.kind === 'error' && <LoadFailed what="this pull request" />}
      </div>
    );
  }

  const { snapshot, revisions, viewer } = page;
  const { pullRequest, revision } = snapshot;
  const status = approvalStatus(snapshot);
  const showError =
    revision?.lastError && (revision.syncState === 'error' || revision.syncState === 'unknown');

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {backLink}
          <OperatorBar login={viewer.operator.login} csrfToken={viewer.csrfToken} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            #{pullRequest.number} {pullRequest.title}
          </h1>
          <div role="group" aria-label="Approval status">
            <StatusBadge display={APPROVAL_STATUS_DISPLAY[status]} />
          </div>
        </div>
        <Summary snapshot={snapshot} />
        <ExternalLink href={pullRequest.htmlUrl}>View pull request on GitHub</ExternalLink>
      </div>
      <Separator />
      <section aria-labelledby="approval-heading" className="space-y-4">
        <h2 id="approval-heading" className="text-lg font-semibold">
          Approval
        </h2>
        <p className="text-sm">{APPROVAL_STATUS_NOTICE[status]}</p>
        {showError && (
          <p className="text-sm break-words text-muted-foreground">
            Last sync error: {revision.lastError}
          </p>
        )}
        {revision && (
          <ApprovalActions
            repositoryId={pullRequest.repositoryId}
            number={pullRequest.number}
            headSha={revision.headSha}
            revision={revision.generation}
            csrfToken={viewer.csrfToken}
            canApprove={canApprove(snapshot)}
            canRetrySync={revision.syncState !== 'synced' && status !== 'blocked'}
          />
        )}
      </section>
      <section aria-labelledby="history-heading" className="space-y-4">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <RevisionHistory revisions={revisions} activeRevisionId={pullRequest.activeRevisionId} />
      </section>
    </div>
  );
}
