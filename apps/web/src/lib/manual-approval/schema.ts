import { z } from 'zod';

/** GitHub이 돌려주는 전체 commit SHA. 줄인 SHA는 받지 않는다. */
export const HeadShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, 'Expected a 40-character lowercase SHA');

/** GitHub numeric ID(저장소 · installation · 사용자 · check run). 이름 대신 이것으로 판정한다. */
export const GitHubIdSchema = z.int().positive();

export const PullRequestStateSchema = z.enum(['open', 'closed', 'merged']);
export const SyncStateSchema = z.enum(['pending', 'synced', 'error', 'unknown']);
export const BlockedReasonSchema = z.enum([
  'installation-suspended',
  'installation-deleted',
  'repository-removed',
]);

/** PR identity. 저장소 표시명이 바뀌어도 같은 PR이다. */
export const PullRequestKeySchema = z.strictObject({
  repositoryId: GitHubIdSchema,
  number: z.int().positive(),
});

/**
 * GitHub에서 **다시 읽은** 현재 PR. webhook payload가 아니라 재조회 결과만 이 모양으로 들어온다.
 * GitHub adapter(Step 3)가 이 schema로 검증해 넘긴다.
 */
export const ObservedPullRequestSchema = z.strictObject({
  ...PullRequestKeySchema.shape,
  installationId: GitHubIdSchema,
  owner: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  authorLogin: z.string().min(1),
  htmlUrl: z.url(),
  headSha: HeadShaSchema,
  state: PullRequestStateSchema,
});

/** 승인 form 입력. 화면이 보던 HEAD · generation과 서버가 다시 읽은 값이 같아야 한다. */
export const ApproveInputSchema = z.strictObject({
  expectedHeadSha: HeadShaSchema,
  expectedRevision: z.coerce.number().int().positive(),
});

/** 승인자. 세션에서 서버가 채운다. 요청 body에서 받지 않는다. */
export const ApproverSchema = z.strictObject({
  githubUserId: GitHubIdSchema,
  login: z.string().min(1),
});

/** DB에 저장된 PR. repository가 행을 이 schema로 검증해 돌려준다. */
export const PullRequestRecordSchema = z.strictObject({
  ...ObservedPullRequestSchema.shape,
  id: z.int().positive(),
  activeRevisionId: z.int().positive().nullable(),
  blockedReason: BlockedReasonSchema.nullable(),
  version: z.int().positive(),
  updatedAt: z.date(),
});

const revisionBase = {
  id: z.int().positive(),
  pullRequestId: z.int().positive(),
  generation: z.int().positive(),
  headSha: HeadShaSchema,
  checkRunId: GitHubIdSchema.nullable(),
  syncState: SyncStateSchema,
  lastError: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  version: z.int().positive(),
  createdAt: z.date(),
};

/** 승인 단위. decision별 불변식은 union 구조에 담는다 — pending에는 승인자가 없고, approved에는 반드시 있다. */
export const RevisionRecordSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    ...revisionBase,
    decision: z.literal('pending'),
    // cancelled — 현재가 아니게 된(새 HEAD · close · merge) 미승인 revision의 대기 Check를 닫는다
    desiredCheckState: z.enum(['queued', 'cancelled']),
    approverId: z.null(),
    approverLogin: z.null(),
    decisionAt: z.null(),
  }),
  z.strictObject({
    ...revisionBase,
    decision: z.literal('approved'),
    desiredCheckState: z.literal('success'),
    approverId: GitHubIdSchema,
    approverLogin: z.string().min(1),
    decisionAt: z.date(),
  }),
]);

export type PullRequestRecord = z.infer<typeof PullRequestRecordSchema>;
export type RevisionRecord = z.infer<typeof RevisionRecordSchema>;
export type PullRequestKey = z.infer<typeof PullRequestKeySchema>;
export type ObservedPullRequest = z.infer<typeof ObservedPullRequestSchema>;
export type ApproveInput = z.infer<typeof ApproveInputSchema>;
export type Approver = z.infer<typeof ApproverSchema>;
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
export type BlockedReason = z.infer<typeof BlockedReasonSchema>;
