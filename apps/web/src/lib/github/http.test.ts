import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  deadlineIn,
  GITHUB_API_VERSION,
  GitHubApiError,
  githubRequest,
  type Transport,
} from './http.ts';

const TOKEN = 'ghs_secret_token_value';
const schema = z.object({ ok: z.boolean() });

const respond =
  (status: number, headers: Record<string, string> = {}, body: unknown = { ok: true }): Transport =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'x-github-request-id': 'ABCD:1234', ...headers },
    });

const call = (transport: Transport, deadlineMs = 1_000) =>
  githubRequest(transport, {
    method: 'GET',
    url: '/repos/o/r',
    token: TOKEN,
    deadline: deadlineIn(deadlineMs),
    schema,
  });

async function failure(transport: Transport, deadlineMs?: number): Promise<GitHubApiError> {
  try {
    await call(transport, deadlineMs);
  } catch (error) {
    return error as GitHubApiError;
  }
  throw new Error('Expected a GitHubApiError');
}

describe('githubRequest', () => {
  it('sends the pinned API version and bearer token', async () => {
    let seen: Request | undefined;
    await call(async (url, init) => {
      seen = new Request(url, init);
      return respond(200)(url, init);
    });
    expect(seen?.headers.get('x-github-api-version')).toBe(GITHUB_API_VERSION);
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(seen?.url).toBe('https://api.github.com/repos/o/r');
  });

  it.each([
    [429, {}, 'rate-limited'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }, 'rate-limited'],
    [403, { 'retry-after': '30' }, 'rate-limited'],
    [403, {}, 'forbidden'],
    [401, {}, 'unauthorized'],
    [404, {}, 'not-found'],
    [422, {}, 'invalid'],
    [502, {}, 'server'],
  ] as const)('classifies %i %j as %s', async (status, headers, kind) => {
    const error = await failure(respond(status, headers));
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error.kind).toBe(kind);
    expect(error.requestId).toBe('ABCD:1234');
  });

  it('reports retry-after and keeps the token out of the message', async () => {
    const error = await failure(respond(403, { 'retry-after': '30' }));
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).toContain('ABCD:1234');
    expect(error.message).not.toContain(TOKEN);
  });

  it('marks timeouts, network loss and 5xx as unknown outcomes', async () => {
    const hang: Transport = (_url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason)),
      );
    expect((await failure(hang, 50)).kind).toBe('timeout');
    expect((await failure(async () => Promise.reject(new TypeError('fetch failed')))).kind).toBe(
      'network',
    );
    for (const error of [await failure(hang, 50), await failure(respond(500))]) {
      expect(error.outcomeUnknown).toBe(true);
    }
    expect((await failure(respond(404))).outcomeUnknown).toBe(false);
  });

  it('does not call GitHub after the deadline', async () => {
    let called = false;
    const error = await failure(async () => {
      called = true;
      return new Response('{}');
    }, -1);
    expect(error.kind).toBe('timeout');
    expect(called).toBe(false);
  });

  it('rejects a response that does not match the schema', async () => {
    expect((await failure(respond(200, {}, { unexpected: true }))).kind).toBe('invalid');
  });
});
