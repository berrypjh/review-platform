import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashToken } from '../auth/session.ts';
import { createSession, findSession } from '../auth/store.ts';
import { openTestDatabase, type TestDatabase } from '../db/test-database.ts';
import { MANUAL_ONLY_NOTICE, STATUS_CONTEXT } from '../github/statuses.ts';
import { loadSnapshot } from './repository.ts';
import { approvalStatus } from './state.ts';
import {
  NOT_ALLOWED,
  pullRequestPayload,
  sha,
  SHARED_STACK,
  signedWebhook,
  testHarness,
} from './test-support.ts';
import { handleWebhook } from './webhook.ts';

const A = sha('a');
const B = sha('b');
const KEY = { repositoryId: SHARED_STACK.id, number: 7 };

let db: TestDatabase;
let h: ReturnType<typeof testHarness>;

beforeEach(async () => {
  db = await openTestDatabase();
  h = testHarness(db.sql);
});

afterEach(async () => {
  await db.close();
});

const send = (event: string, payload: unknown, deliveryId?: string) =>
  handleWebhook(h.deps(), signedWebhook(h.config, event, payload, deliveryId));
const prEvent = (action: string, options: Parameters<typeof pullRequestPayload>[3] = {}) =>
  send('pull_request', pullRequestPayload(SHARED_STACK, 7, action, options));
const snapshot = async () => {
  const found = await loadSnapshot(db.sql, KEY);
  if (!found) throw new Error('PR is not stored');
  return found;
};
const shown = (sha: string) => h.github.latestStatus(sha)?.state;
const STATUS_POST = /\/statuses\/[0-9a-f]{40}$/;
const deliveryStatus = async (deliveryId: string) =>
  (
    await db.sql<
      { status: string }[]
    >`SELECT status FROM webhook_deliveries WHERE delivery_id = ${deliveryId}`
  )[0]?.status;

describe('pull_request webhooks', () => {
  it('registers a new PR and sets exactly one pending status on its head', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    expect(await prEvent('opened')).toEqual({ status: 200, result: 'processed' });

    const [status, ...rest] = h.github.statusesOf(A);
    expect(rest).toEqual([]);
    expect(status).toMatchObject({
      context: STATUS_CONTEXT,
      state: 'pending',
      target_url: 'https://review.example/pulls/101/7',
    });
    expect(status?.description).toContain(MANUAL_ONLY_NOTICE);
    const stored = await snapshot();
    expect(stored.revision?.syncState).toBe('synced');
    expect(approvalStatus(stored)).toBe('pending');
  });

  it('rejects a tampered body without storing anything', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    const request = signedWebhook(
      h.config,
      'pull_request',
      pullRequestPayload(SHARED_STACK, 7, 'opened'),
    );
    const tampered = {
      ...request,
      body: new TextEncoder().encode(JSON.stringify({ action: 'closed' })),
    };
    expect(await handleWebhook(h.deps(), tampered)).toEqual({ status: 401, result: 'rejected' });
    expect(await db.sql`SELECT 1 FROM webhook_deliveries`).toHaveLength(0);
    expect(h.github.requests).toEqual([]);
  });

  it('treats a processed delivery as a no-op', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    const payload = pullRequestPayload(SHARED_STACK, 7, 'opened');
    expect((await send('pull_request', payload, 'same-id')).result).toBe('processed');
    const callsBefore = h.github.requests.length;
    expect(await send('pull_request', payload, 'same-id')).toEqual({
      status: 200,
      result: 'duplicate',
    });
    expect(h.github.requests.length).toBe(callsBefore);
    expect(h.github.statusesOf(A)).toHaveLength(1);
  });

  it('ignores repositories outside the allowlist and foreign installations', async () => {
    h.github.addPull({ repositoryId: NOT_ALLOWED.id, number: 1, headSha: A });
    expect((await send('pull_request', pullRequestPayload(NOT_ALLOWED, 1, 'opened'))).result).toBe(
      'ignored',
    );
    expect((await prEvent('opened', { installationId: 6 })).result).toBe('ignored');
    expect(await db.sql`SELECT 1 FROM pull_requests`).toHaveLength(0);
    expect(h.github.statuses).toEqual([]);
  });

  it('reads the current head from GitHub instead of a late payload', async () => {
    const pull = h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    await prEvent('opened', { headSha: A });
    pull.headSha = B;
    await prEvent('synchronize', { headSha: B });
    expect((await prEvent('synchronize', { headSha: A })).result).toBe('processed');
    const stored = await snapshot();
    expect(stored.pullRequest.headSha).toBe(B);
    expect(stored.revision?.generation).toBe(2);
  });

  it('records the status on the base repository for a fork PR', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    expect((await prEvent('opened', { fork: true })).result).toBe('processed');
    expect(h.github.statusesOf(A).map((status) => status.repositoryId)).toEqual([SHARED_STACK.id]);
  });

  it('closes the old head status on push and sets the new head pending', async () => {
    const pull = h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    await prEvent('opened');
    pull.headSha = B;
    await prEvent('synchronize');
    expect(shown(A)).toBe('error');
    expect(shown(B)).toBe('pending');
  });

  it('closes the waiting status when the PR closes and keeps the history', async () => {
    const pull = h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    await prEvent('opened');
    pull.state = 'closed';
    await prEvent('closed');
    expect(shown(A)).toBe('error');
    expect(approvalStatus(await snapshot())).toBe('closed');
  });
});

describe('statuses of other contexts', () => {
  it('never modifies a status of another context on the same commit', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    h.github.statuses.push({
      id: 1,
      repositoryId: SHARED_STACK.id,
      sha: A,
      state: 'failure',
      context: 'CI / checks',
      description: null,
      target_url: null,
    });
    await prEvent('opened');
    expect(h.github.latestStatus(A, 'CI / checks')).toMatchObject({ id: 1, state: 'failure' });
    expect(shown(A)).toBe('pending');
  });
});

describe('webhook failures', () => {
  it('leaves a failed delivery and a non-2xx when GitHub fails, then recovers on redelivery', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    h.github.fail('POST', STATUS_POST, { kind: 'status', status: 502 });
    const payload = pullRequestPayload(SHARED_STACK, 7, 'opened');
    expect(await send('pull_request', payload, 'retry-me')).toEqual({
      status: 503,
      result: 'failed',
    });
    expect(await deliveryStatus('retry-me')).toBe('failed');
    expect((await snapshot()).revision?.syncState).toBe('unknown');

    expect(await send('pull_request', payload, 'retry-me')).toEqual({
      status: 200,
      result: 'processed',
    });
    expect(h.github.statusesOf(A)).toHaveLength(1);
  });

  it('re-sends the status after a lost POST response and records it as synced', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    h.github.fail('POST', STATUS_POST, { kind: 'lose-response' });
    const payload = pullRequestPayload(SHARED_STACK, 7, 'opened');
    expect((await send('pull_request', payload, 'lost')).status).toBe(503);
    expect((await snapshot()).revision?.syncState).toBe('unknown');

    expect((await send('pull_request', payload, 'lost')).result).toBe('processed');
    // 같은 context에 다시 쓴다. 보이는 상태는 pending 하나다.
    expect(h.github.statusesOf(A)).toHaveLength(2);
    expect(shown(A)).toBe('pending');
    expect((await snapshot()).revision?.syncState).toBe('synced');
  });

  it('times out inside the webhook budget and records the outcome as unknown', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    h.github.fail('POST', STATUS_POST, { kind: 'timeout' });
    const started = Date.now();
    const result = await handleWebhook(
      h.deps(1_500),
      signedWebhook(
        h.config,
        'pull_request',
        pullRequestPayload(SHARED_STACK, 7, 'opened'),
        'slow',
      ),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.status).toBe(503);
    expect((await snapshot()).revision?.syncState).toBe('unknown');
  });
});

describe('installation and authorization events', () => {
  it('blocks the PRs of a suspended installation and unblocks on unsuspend', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    await prEvent('opened');
    await send('installation', { action: 'suspend', installation: { id: 5 } });
    expect(approvalStatus(await snapshot())).toBe('blocked');
    await send('installation', { action: 'unsuspend', installation: { id: 5 } });
    expect(approvalStatus(await snapshot())).toBe('pending');
  });

  it('blocks PRs of a repository removed from the installation', async () => {
    h.github.addPull({ repositoryId: SHARED_STACK.id, number: 7, headSha: A });
    await prEvent('opened');
    await send('installation_repositories', {
      action: 'removed',
      installation: { id: 5 },
      repositories_removed: [{ id: SHARED_STACK.id }],
    });
    expect((await snapshot()).pullRequest.blockedReason).toBe('repository-removed');
  });

  it('revokes the sessions of a user who withdrew the app authorization', async () => {
    const tokenHash = hashToken('session-token');
    await createSession(db.sql, {
      tokenHash,
      githubUserId: 42,
      login: 'operator',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      (await send('github_app_authorization', { action: 'revoked', sender: { id: 42 } })).result,
    ).toBe('processed');
    expect(await findSession(db.sql, tokenHash)).toBeNull();
  });

  it('answers ping without side effects', async () => {
    expect(await send('ping', { zen: 'Keep it logically awesome.' })).toEqual({
      status: 200,
      result: 'ignored',
    });
    expect(h.github.requests).toEqual([]);
  });
});
