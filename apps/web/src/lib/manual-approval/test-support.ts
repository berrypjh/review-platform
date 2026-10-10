/** 테스트 전용 composition. 실제 DB(테스트 schema)와 가짜 GitHub transport를 묶는다. 런타임은 이 파일을 import하지 않는다. */
import { createHmac, generateKeyPairSync } from 'node:crypto';

import type { Db } from '../db/config.ts';
import { createGitHubApi } from '../github/api.ts';
import { FakeGitHub } from '../github/fake-github.ts';
import { deadlineIn } from '../github/http.ts';
import type { ManualApprovalConfig } from './config.ts';
import type { ApprovalDeps } from './sync.ts';
import type { WebhookRequest } from './webhook.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

export const SHARED_STACK = { id: 101, owner: 'berrypjh', name: 'shared-stack' };
export const BLOG = { id: 102, owner: 'berrypjh', name: 'it-tech-blog' };
export const NOT_ALLOWED = { id: 999, owner: 'someone', name: 'other' };
export const OPERATOR = { githubUserId: 42, login: 'operator' };
export const sha = (char: string) => char.repeat(40);

export function testConfig(overrides: Partial<ManualApprovalConfig> = {}): ManualApprovalConfig {
  return {
    clientId: 'Iv1.testclient',
    clientSecret: 'client-secret-value',
    privateKey,
    webhookSecret: 'webhook-secret-value',
    installationId: 5,
    allowedRepositoryIds: new Set([SHARED_STACK.id, BLOG.id]),
    approverIds: new Set([OPERATOR.githubUserId]),
    publicBaseUrl: 'https://review.example',
    ...overrides,
  };
}

export function testHarness(sql: Db, config = testConfig()) {
  const github = new FakeGitHub(
    config.clientId,
    config.clientSecret,
    config.installationId,
    privateKey,
  );
  for (const repo of [SHARED_STACK, BLOG, NOT_ALLOWED]) github.addRepo(repo);
  const deps = (deadlineMs = 8_000): ApprovalDeps => ({
    sql,
    github: createGitHubApi(github.transport, config, deadlineIn(deadlineMs)),
  });
  return { config, github, deps };
}

let deliveries = 0;

/** GitHub이 보내는 것과 같은 모양의 서명된 webhook 요청. */
export function signedWebhook(
  config: ManualApprovalConfig,
  event: string,
  payload: unknown,
  deliveryId = `delivery-${++deliveries}`,
): WebhookRequest {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const signature = `sha256=${createHmac('sha256', config.webhookSecret).update(body).digest('hex')}`;
  return { event, deliveryId, signature, body };
}

/** `pull_request` webhook payload. head SHA를 넣지만 서버는 쓰지 않는다(재조회만 믿는다). */
export function pullRequestPayload(
  repo: { id: number; owner: string; name: string },
  number: number,
  action: string,
  options: { installationId?: number; headSha?: string; fork?: boolean } = {},
) {
  return {
    action,
    number,
    pull_request: {
      number,
      head: {
        sha: options.headSha ?? sha('0'),
        repo: options.fork
          ? { id: 555, name: 'fork', owner: { login: 'contributor' } }
          : { id: repo.id },
      },
    },
    repository: { id: repo.id, name: repo.name, owner: { login: repo.owner } },
    installation: { id: options.installationId ?? 5 },
    sender: { id: 31337, login: 'someone-else' },
  };
}
