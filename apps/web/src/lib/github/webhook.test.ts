import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { pullRequestPayload, SHARED_STACK } from '../manual-approval/test-support.ts';
import { classifyWebhook, readLimitedBody, verifyWebhookSignature } from './webhook.ts';

const SECRET = 'webhook-secret-value';
const body = new TextEncoder().encode('{"action":"opened"}');
const sign = (bytes: Uint8Array, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;

describe('verifyWebhookSignature', () => {
  it('accepts the HMAC of the raw body', () => {
    expect(verifyWebhookSignature(SECRET, body, sign(body))).toBe(true);
  });

  it.each([
    ['a tampered body', sign(new TextEncoder().encode('{"action":"closed"}'))],
    ['another secret', sign(body, 'other-secret')],
    ['a missing header', null],
    ['the legacy sha1 header', `sha1=${createHmac('sha1', SECRET).update(body).digest('hex')}`],
    ['a truncated signature', sign(body).slice(0, 20)],
  ])('rejects %s', (_, header) => {
    expect(verifyWebhookSignature(SECRET, body, header)).toBe(false);
  });
});

describe('classifyWebhook', () => {
  it('takes the base repository of a fork PR and never the payload head SHA', () => {
    const event = classifyWebhook(
      'pull_request',
      pullRequestPayload(SHARED_STACK, 7, 'synchronize', { fork: true }),
    );
    expect(event).toEqual({
      kind: 'pull-request',
      action: 'synchronize',
      number: 7,
      installationId: 5,
      repository: { repositoryId: 101, owner: 'berrypjh', name: 'shared-stack' },
    });
  });

  it.each(['labeled', 'assigned', 'review_requested', 'ready_for_review'])(
    'ignores pull_request.%s',
    (action) => {
      expect(
        classifyWebhook('pull_request', pullRequestPayload(SHARED_STACK, 7, action))?.kind,
      ).toBe('ignored');
    },
  );

  it('ignores ping and unrelated events without side effects', () => {
    expect(classifyWebhook('ping', { zen: 'hi' })).toEqual({ kind: 'ignored', reason: 'ping' });
    expect(classifyWebhook('push', {})?.kind).toBe('ignored');
    expect(classifyWebhook('check_run', { action: 'rerequested' })?.kind).toBe('ignored');
    // merge queue는 MVP 범위 밖 — merge_group은 처리하지 않고 기록만 한다
    expect(classifyWebhook('merge_group', { action: 'checks_requested' })).toEqual({
      kind: 'ignored',
      reason: 'merge_group',
    });
  });

  it('maps installation and authorization events', () => {
    expect(classifyWebhook('installation', { action: 'suspend', installation: { id: 5 } })).toEqual(
      {
        kind: 'installation',
        action: 'suspend',
        installationId: 5,
      },
    );
    expect(
      classifyWebhook('installation_repositories', {
        action: 'removed',
        installation: { id: 5 },
        repositories_removed: [{ id: 101 }],
      }),
    ).toEqual({ kind: 'repositories-removed', installationId: 5, repositoryIds: [101] });
    expect(
      classifyWebhook('github_app_authorization', { action: 'revoked', sender: { id: 42 } }),
    ).toEqual({
      kind: 'authorization-revoked',
      githubUserId: 42,
    });
  });

  it('rejects malformed payloads of handled events', () => {
    expect(classifyWebhook('pull_request', { action: 'opened' })).toBeNull();
    expect(classifyWebhook('pull_request', null)).toBeNull();
    expect(classifyWebhook('installation', { action: 'deleted' })).toBeNull();
  });
});

describe('readLimitedBody', () => {
  const stream = (size: number) =>
    new Response(new Uint8Array(size)).body as ReadableStream<Uint8Array>;

  it('reads up to the limit and refuses anything larger', async () => {
    expect((await readLimitedBody(stream(10), 10))?.byteLength).toBe(10);
    expect(await readLimitedBody(stream(11), 10)).toBeNull();
  });
});
