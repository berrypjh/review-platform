import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/** webhook 본문 상한. PR payload는 이보다 훨씬 작다. 넘으면 서명 확인 전에 거부한다. */
export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

/** `X-Hub-Signature-256`(sha256=hex)을 raw body의 HMAC-SHA256과 constant-time으로 비교한다. */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Uint8Array,
  header: string | null,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// 외부 payload는 필요한 필드만 본다. 나머지 필드는 버린다(strict가 아님).
const Id = z.int().positive();
const RepositoryRef = z.object({
  id: Id,
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});
const InstallationRef = z.object({ id: Id });

const PullRequestEvent = z.object({
  action: z.string(),
  number: z.int().positive(),
  repository: RepositoryRef,
  installation: InstallationRef,
});
const InstallationEvent = z.object({ action: z.string(), installation: InstallationRef });
const InstallationRepositoriesEvent = z.object({
  action: z.string(),
  installation: InstallationRef,
  repositories_removed: z.array(z.object({ id: Id })).default([]),
});
const AuthorizationEvent = z.object({ action: z.string(), sender: z.object({ id: Id }) });

/** 처리 대상 PR action. 이 밖의 action은 부작용 없이 무시한다. */
export const HANDLED_PULL_REQUEST_ACTIONS = [
  'opened',
  'reopened',
  'synchronize',
  'edited',
  'closed',
];

export type WebhookEvent =
  | {
      kind: 'pull-request';
      action: string;
      repository: { repositoryId: number; owner: string; name: string };
      number: number;
      installationId: number;
    }
  | { kind: 'installation'; action: 'deleted' | 'suspend' | 'unsuspend'; installationId: number }
  | { kind: 'repositories-removed'; installationId: number; repositoryIds: number[] }
  | { kind: 'authorization-revoked'; githubUserId: number }
  | { kind: 'ignored'; reason: string };

/**
 * 서명이 확인된 payload를 처리 단위로 바꾼다. 형식이 맞지 않으면 `null`(400).
 * PR 이벤트에서 head SHA · sender는 꺼내지 않는다 — HEAD는 GitHub 재조회로만 얻고, sender는 승인자가 아니다.
 * fork PR도 base 저장소(`repository`)의 이벤트로 오므로 같은 경로다.
 */
export function classifyWebhook(event: string, payload: unknown): WebhookEvent | null {
  switch (event) {
    case 'ping':
      return { kind: 'ignored', reason: 'ping' };
    case 'pull_request': {
      const parsed = PullRequestEvent.safeParse(payload);
      if (!parsed.success) return null;
      const { action, number, repository, installation } = parsed.data;
      if (!HANDLED_PULL_REQUEST_ACTIONS.includes(action)) {
        return { kind: 'ignored', reason: `pull_request.${action}` };
      }
      return {
        kind: 'pull-request',
        action,
        number,
        installationId: installation.id,
        repository: {
          repositoryId: repository.id,
          owner: repository.owner.login,
          name: repository.name,
        },
      };
    }
    case 'installation': {
      const parsed = InstallationEvent.safeParse(payload);
      if (!parsed.success) return null;
      const { action, installation } = parsed.data;
      if (action === 'deleted' || action === 'suspend' || action === 'unsuspend') {
        return { kind: 'installation', action, installationId: installation.id };
      }
      return { kind: 'ignored', reason: `installation.${action}` };
    }
    case 'installation_repositories': {
      const parsed = InstallationRepositoriesEvent.safeParse(payload);
      if (!parsed.success) return null;
      const { action, installation, repositories_removed } = parsed.data;
      if (action !== 'removed')
        return { kind: 'ignored', reason: `installation_repositories.${action}` };
      return {
        kind: 'repositories-removed',
        installationId: installation.id,
        repositoryIds: repositories_removed.map((repository) => repository.id),
      };
    }
    case 'github_app_authorization': {
      const parsed = AuthorizationEvent.safeParse(payload);
      if (!parsed.success) return null;
      if (parsed.data.action !== 'revoked')
        return { kind: 'ignored', reason: 'github_app_authorization' };
      return { kind: 'authorization-revoked', githubUserId: parsed.data.sender.id };
    }
    default:
      return { kind: 'ignored', reason: event };
  }
}

/** 본문을 `limit` bytes까지만 읽는다. 넘으면 null — Content-Length가 없는 chunked 본문도 상한을 지킨다. */
export async function readLimitedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
