import { describe, expect, it } from 'vitest';

import {
  ApproveInputSchema,
  type ObservedPullRequest,
  type PullRequestRecord,
  type RevisionRecord,
} from './schema.ts';
import {
  approvalStatus,
  becomesObsolete,
  canApprove,
  checkApproval,
  needsNewRevision,
  nextGeneration,
  pullRequestChanged,
  type Snapshot,
  syncIntent,
} from './state.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const observed = (overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest => ({
  repositoryId: 101,
  number: 7,
  installationId: 9,
  owner: 'berrypjh',
  name: 'shared-stack',
  title: 'Add button',
  authorLogin: 'octocat',
  htmlUrl: 'https://github.com/berrypjh/shared-stack/pull/7',
  headSha: SHA_A,
  state: 'open',
  ...overrides,
});

const pendingRevision = (overrides: Partial<RevisionRecord> = {}): RevisionRecord =>
  ({
    id: 1,
    pullRequestId: 1,
    generation: 1,
    headSha: SHA_A,
    decision: 'pending',
    desiredCheckState: 'queued',
    approverId: null,
    approverLogin: null,
    decisionAt: null,
    syncState: 'pending',
    lastError: null,
    lastSyncedAt: null,
    version: 1,
    createdAt: new Date('2026-10-10T00:00:00Z'),
    ...overrides,
  }) as RevisionRecord;

const approvedRevision = (overrides: Partial<RevisionRecord> = {}): RevisionRecord =>
  pendingRevision({
    decision: 'approved',
    desiredCheckState: 'success',
    approverId: 42,
    approverLogin: 'operator',
    decisionAt: new Date('2026-10-10T01:00:00Z'),
    ...overrides,
  } as Partial<RevisionRecord>);

const snapshot = (
  pr: Partial<PullRequestRecord> = {},
  revision: RevisionRecord | null = pendingRevision(),
): Snapshot => ({
  pullRequest: {
    ...observed(),
    id: 1,
    activeRevisionId: revision?.id ?? null,
    blockedReason: null,
    version: 1,
    updatedAt: new Date('2026-10-10T00:00:00Z'),
    ...pr,
  },
  revision,
});

describe('needsNewRevision', () => {
  it('opens generation 1 for a new open PR', () => {
    expect(needsNewRevision(null, observed())).toBe(true);
    expect(nextGeneration(null)).toBe(1);
  });

  it('does not open a revision for a PR first seen closed', () => {
    expect(needsNewRevision(null, observed({ state: 'closed' }))).toBe(false);
  });

  it('does not open a revision when the same observation repeats', () => {
    expect(needsNewRevision(snapshot(), observed())).toBe(false);
  });

  it('opens a revision when the head changes', () => {
    expect(needsNewRevision(snapshot(), observed({ headSha: SHA_B }))).toBe(true);
    expect(nextGeneration(snapshot())).toBe(2);
  });

  it('treats A -> B -> A as a new unit instead of reviving A', () => {
    const atB = snapshot({ headSha: SHA_B }, approvedRevision({ generation: 2, headSha: SHA_B }));
    expect(needsNewRevision(atB, observed({ headSha: SHA_A }))).toBe(true);
    expect(nextGeneration(atB)).toBe(3);
  });

  it('opens a revision when a closed PR is reopened at the same head', () => {
    const closed = snapshot({ state: 'closed' }, approvedRevision());
    expect(needsNewRevision(closed, observed())).toBe(true);
  });

  it('does not open a revision when a PR closes or merges', () => {
    expect(needsNewRevision(snapshot(), observed({ state: 'closed' }))).toBe(false);
    expect(needsNewRevision(snapshot(), observed({ state: 'merged' }))).toBe(false);
  });
});

describe('becomesObsolete', () => {
  it('closes the waiting check of a pending revision on a new head, close or merge', () => {
    expect(becomesObsolete(snapshot(), observed({ headSha: SHA_B }))).toBe(true);
    expect(becomesObsolete(snapshot(), observed({ state: 'closed' }))).toBe(true);
    expect(becomesObsolete(snapshot(), observed({ state: 'merged' }))).toBe(true);
  });

  it('keeps an approved revision and ignores repeated observations', () => {
    expect(becomesObsolete(snapshot({}, approvedRevision()), observed({ headSha: SHA_B }))).toBe(
      false,
    );
    expect(becomesObsolete(snapshot(), observed())).toBe(false);
    expect(becomesObsolete(null, observed())).toBe(false);
  });

  it('does not cancel twice', () => {
    const cancelled = pendingRevision({
      desiredCheckState: 'cancelled',
    } as Partial<RevisionRecord>);
    expect(becomesObsolete(snapshot({ state: 'closed' }, cancelled), observed())).toBe(false);
  });
});

describe('pullRequestChanged', () => {
  it('ignores identical observations and detects a rename', () => {
    const current = snapshot().pullRequest;
    expect(pullRequestChanged(current, observed())).toBe(false);
    expect(pullRequestChanged(current, observed({ name: 'shared-stack-renamed' }))).toBe(true);
  });
});

describe('checkApproval', () => {
  const input = { expectedHeadSha: SHA_A, expectedRevision: 1 };

  it('approves the current pending revision', () => {
    expect(checkApproval(snapshot(), input).kind).toBe('approve');
  });

  it('keeps the first decision for a repeated approval', () => {
    const result = checkApproval(snapshot({}, approvedRevision()), input);
    expect(result).toMatchObject({ kind: 'already-approved', revision: { approverId: 42 } });
  });

  it.each([
    ['not-found', null, input],
    ['not-open', snapshot({ state: 'closed' }), input],
    ['not-open', snapshot({ state: 'merged' }), input],
    ['blocked', snapshot({ blockedReason: 'repository-removed' }), input],
    ['no-revision', snapshot({}, null), input],
    ['revision-changed', snapshot(), { ...input, expectedRevision: 2 }],
    ['head-changed', snapshot(), { ...input, expectedHeadSha: SHA_B }],
  ] as const)('rejects with %s', (reason, current, request) => {
    expect(checkApproval(current, request)).toEqual({ kind: 'rejected', reason });
  });

  it('rejects an approval aimed at an older generation after A -> B -> A', () => {
    const backAtA = snapshot({}, pendingRevision({ generation: 3 }));
    expect(checkApproval(backAtA, input)).toEqual({ kind: 'rejected', reason: 'revision-changed' });
  });
});

describe('approvalStatus', () => {
  it.each([
    ['pending', snapshot()],
    ['syncing', snapshot({}, approvedRevision({ syncState: 'pending' }))],
    ['sync-unknown', snapshot({}, approvedRevision({ syncState: 'unknown' }))],
    ['sync-error', snapshot({}, approvedRevision({ syncState: 'error' }))],
    ['approved', snapshot({}, approvedRevision({ syncState: 'synced' }))],
    ['closed', snapshot({ state: 'closed' }, approvedRevision({ syncState: 'synced' }))],
    ['merged', snapshot({ state: 'merged' })],
    ['blocked', snapshot({ blockedReason: 'installation-suspended' })],
  ] as const)('is %s', (status, current) => {
    expect(approvalStatus(current)).toBe(status);
  });

  it('only allows approving an open pending revision', () => {
    expect(canApprove(snapshot())).toBe(true);
    expect(canApprove(snapshot({ state: 'closed' }))).toBe(false);
    expect(canApprove(snapshot({}, approvedRevision()))).toBe(false);
    expect(canApprove(snapshot({}, null))).toBe(false);
  });
});

describe('syncIntent', () => {
  it('starts a new head with a queued status intent', () => {
    expect(syncIntent(snapshot())).toEqual({
      key: { repositoryId: 101, number: 7 },
      revisionId: 1,
      revisionVersion: 1,
      generation: 1,
      headSha: SHA_A,
      desired: 'queued',
    });
  });

  it('asks for success after approval and nothing once synced', () => {
    expect(syncIntent(snapshot({}, approvedRevision()))?.desired).toBe('success');
    expect(syncIntent(snapshot({}, approvedRevision({ syncState: 'synced' })))).toBeNull();
  });
});

describe('ApproveInputSchema', () => {
  it('requires a full SHA and a positive revision from form strings', () => {
    expect(ApproveInputSchema.parse({ expectedHeadSha: SHA_A, expectedRevision: '2' })).toEqual({
      expectedHeadSha: SHA_A,
      expectedRevision: 2,
    });
    expect(
      ApproveInputSchema.safeParse({ expectedHeadSha: 'abc1234', expectedRevision: '1' }).success,
    ).toBe(false);
    expect(
      ApproveInputSchema.safeParse({ expectedHeadSha: SHA_A, expectedRevision: '0' }).success,
    ).toBe(false);
  });
});
