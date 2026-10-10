import {
  Ban,
  Check,
  CircleHelp,
  CircleX,
  Clock,
  GitMerge,
  GitPullRequestClosed,
  RefreshCw,
} from 'lucide-react';

import type { StatusDisplay } from '../status-display.ts';
import type { PullRequestRecord, RevisionRecord } from './schema.ts';
import type { ApprovalStatus } from './state.ts';

const WARNING = 'border-amber-300 bg-amber-50 text-amber-900';

/**
 * 수동 승인 상태의 표시. Visual run status(`RUN_STATUS_DISPLAY`)와 섞지 않는다.
 * 상태 계산은 `approvalStatus` 하나 — 여기서는 이름 · 아이콘만 정한다.
 */
export const APPROVAL_STATUS_DISPLAY = {
  pending: { label: 'Pending approval', icon: Clock, variant: 'outline', className: WARNING },
  syncing: { label: 'Syncing to GitHub', icon: RefreshCw, variant: 'outline' },
  'sync-unknown': {
    label: 'Sync unknown',
    icon: CircleHelp,
    variant: 'outline',
    className: WARNING,
  },
  'sync-error': { label: 'Sync error', icon: CircleX, variant: 'destructive' },
  approved: { label: 'Approved', icon: Check, variant: 'secondary' },
  closed: { label: 'Closed', icon: GitPullRequestClosed, variant: 'outline' },
  merged: { label: 'Merged', icon: GitMerge, variant: 'outline' },
  blocked: { label: 'Blocked', icon: Ban, variant: 'destructive' },
} satisfies Record<ApprovalStatus, StatusDisplay>;

/** 상태별 안내. 사실만 말한다 — 반영을 확인하지 못했으면 승인됐다고 쓰지 않는다. */
export const APPROVAL_STATUS_NOTICE: Record<ApprovalStatus, string> = {
  pending: 'This head commit has not been approved. The GitHub check stays queued until it is.',
  syncing:
    'The approval is recorded here, but GitHub has not confirmed the check yet. It is not approved on GitHub until it does.',
  'sync-unknown':
    'The approval is recorded here, but the last update to GitHub timed out or lost its response. It may or may not have reached GitHub. Retry sync to confirm.',
  'sync-error':
    'The approval is recorded here, but updating the GitHub check failed. GitHub does not show it as approved. Retry sync after the cause is fixed.',
  approved: 'Approved here and confirmed on GitHub for the current head commit.',
  closed: 'This pull request is closed. Approval is disabled. Past decisions are kept below.',
  merged: 'This pull request is merged. Approval is disabled. Past decisions are kept below.',
  blocked:
    'Access to this repository through the GitHub App was removed or suspended. Approval is disabled until access is restored and synced.',
};

export const PULL_REQUEST_STATE_LABEL: Record<PullRequestRecord['state'], string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
};

export const SYNC_STATE_LABEL: Record<RevisionRecord['syncState'], string> = {
  pending: 'Waiting to sync',
  synced: 'Synced',
  error: 'Error',
  unknown: 'Unknown',
};

/** revision 이력의 결정 표시. 현재가 아니게 된 미승인 revision은 cancelled로 닫힌 것이다. */
export function decisionLabel(revision: RevisionRecord): string {
  if (revision.decision === 'approved') return 'Approved';
  return revision.desiredCheckState === 'cancelled' ? 'Superseded' : 'Pending';
}
