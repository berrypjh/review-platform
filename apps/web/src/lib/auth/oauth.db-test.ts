import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase, type TestDatabase } from '../db/test-database.ts';
import { deadlineIn } from '../github/http.ts';
import { OPERATOR, testConfig, testHarness } from '../manual-approval/test-support.ts';
import { callbackUrl, completeLogin, startLogin } from './oauth.ts';
import { csrfTokenFor, guardMutation, hashToken, SESSION_COOKIE } from './session.ts';
import { createOAuthTransaction, createSession, findSession } from './store.ts';

let db: TestDatabase;
let h: ReturnType<typeof testHarness>;

beforeEach(async () => {
  db = await openTestDatabase();
  h = testHarness(db.sql);
});

afterEach(async () => {
  await db.close();
});

const user = { id: OPERATOR.githubUserId, login: OPERATOR.login };

async function begin(returnTo: string | null = '/pulls/101/7') {
  const { location, binding } = await startLogin(db.sql, h.config, returnTo);
  const url = new URL(location);
  return {
    url,
    binding,
    state: url.searchParams.get('state') ?? '',
    challenge: url.searchParams.get('code_challenge') ?? '',
  };
}

const complete = (
  input: { code: string | null; state: string | null; binding: string | null },
  config = h.config,
) =>
  completeLogin(
    { sql: db.sql, transport: h.github.transport, config, deadline: deadlineIn(5_000) },
    input,
  );

describe('GitHub login', () => {
  it('asks GitHub for the fixed callback with S256 PKCE and a one-time state', async () => {
    const { url } = await begin();
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(h.config.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(callbackUrl(h.config));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('creates a session for an approver identified by numeric ID and returns to the page', async () => {
    const { binding, state, challenge } = await begin();
    const result = await complete({ code: h.github.authorize(challenge, user), state, binding });
    if (result.kind !== 'ok') throw new Error(`Expected ok, got ${result.kind}`);
    expect(result.returnTo).toBe('/pulls/101/7');
    expect(await findSession(db.sql, hashToken(result.sessionToken))).toEqual(OPERATOR);
  });

  it('rejects a replayed state', async () => {
    const { binding, state, challenge } = await begin();
    await complete({ code: h.github.authorize(challenge, user), state, binding });
    expect(await complete({ code: h.github.authorize(challenge, user), state, binding })).toEqual({
      kind: 'invalid',
    });
  });

  it('rejects a callback from another browser and burns the state', async () => {
    const { state, challenge, binding } = await begin();
    expect(
      await complete({
        code: h.github.authorize(challenge, user),
        state,
        binding: 'other-browser',
      }),
    ).toEqual({
      kind: 'invalid',
    });
    expect(await complete({ code: h.github.authorize(challenge, user), state, binding })).toEqual({
      kind: 'invalid',
    });
  });

  it('rejects a code issued for a different PKCE challenge', async () => {
    const { binding, state } = await begin();
    expect(
      await complete({ code: h.github.authorize('other-challenge', user), state, binding }),
    ).toEqual({
      kind: 'invalid',
    });
  });

  it('rejects an expired state', async () => {
    const state = 'x'.repeat(43);
    await createOAuthTransaction(db.sql, {
      state,
      browserBindingHash: hashToken('binding'),
      codeVerifier: 'v'.repeat(43),
      returnTo: '/',
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(await complete({ code: 'code-1', state, binding: 'binding' })).toEqual({
      kind: 'invalid',
    });
  });

  it('does not create a session for a GitHub user outside APPROVER_GITHUB_IDS', async () => {
    const { binding, state, challenge } = await begin();
    const outsider = { id: 7_000, login: 'operator' };
    expect(
      await complete({ code: h.github.authorize(challenge, outsider), state, binding }),
    ).toEqual({
      kind: 'forbidden',
    });
    expect(await db.sql`SELECT 1 FROM sessions`).toHaveLength(0);
  });
});

describe('guardMutation', () => {
  const token = 'session-token-value';

  async function signedIn(expiresInMs = 60_000) {
    await createSession(db.sql, {
      tokenHash: hashToken(token),
      ...OPERATOR,
      expiresAt: new Date(Date.now() + expiresInMs),
    });
  }

  const request = (
    overrides: Partial<{
      origin: string | null;
      cookieHeader: string | null;
      csrfToken: string | null;
    }> = {},
  ) => ({
    origin: 'https://review.example',
    cookieHeader: `${SESSION_COOKIE}=${token}`,
    csrfToken: csrfTokenFor(token),
    ...overrides,
  });

  it('accepts the exact origin, an operator session and the bound CSRF token', async () => {
    await signedIn();
    expect(await guardMutation(db.sql, h.config, request())).toMatchObject({
      kind: 'ok',
      operator: OPERATOR,
    });
  });

  it.each([
    ['a missing origin', { origin: null }, 'bad-origin'],
    ['another origin', { origin: 'https://evil.example' }, 'bad-origin'],
    ['plain http', { origin: 'http://review.example' }, 'bad-origin'],
    ['no session cookie', { cookieHeader: null }, 'unauthenticated'],
    ['a missing CSRF token', { csrfToken: null }, 'bad-csrf'],
    ['a CSRF token of another session', { csrfToken: csrfTokenFor('other') }, 'bad-csrf'],
  ] as const)('rejects %s', async (_, overrides, kind) => {
    await signedIn();
    expect(await guardMutation(db.sql, h.config, request(overrides))).toEqual({ kind });
  });

  it('rejects an expired session', async () => {
    await signedIn(-1_000);
    expect(await guardMutation(db.sql, h.config, request())).toEqual({ kind: 'unauthenticated' });
  });

  it('rejects a session whose user was removed from APPROVER_GITHUB_IDS', async () => {
    await signedIn();
    const config = testConfig({ approverIds: new Set([1]) });
    expect(await guardMutation(db.sql, config, request())).toEqual({ kind: 'unauthenticated' });
  });
});
