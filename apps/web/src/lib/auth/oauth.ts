import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { Db } from '../db/config.ts';
import { type Deadline, githubRequest, remainingMs, type Transport } from '../github/http.ts';
import type { ManualApprovalConfig } from '../manual-approval/config.ts';
import { hashToken, randomToken, SESSION_TTL_SECONDS } from './session.ts';
import { consumeOAuthTransaction, createOAuthTransaction, createSession } from './store.ts';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const STATE_TTL_MS = 10 * 60 * 1000;

export const callbackUrl = (config: ManualApprovalConfig) =>
  `${config.publicBaseUrl}/api/auth/github/callback`;

/** 로그인 뒤 돌아갈 경로. 같은 사이트 안의 절대 경로만 받는다 — 외부 · protocol-relative URL은 `/`로. */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return '/';
  return value;
}

/**
 * 로그인 시작. 일회성 state · 브라우저 binding · PKCE(S256) verifier를 만들어 state를 DB에 둔다.
 * binding 원문은 쿠키로만 브라우저에 가고 DB에는 hash만 남는다.
 */
export async function startLogin(
  sql: Db,
  config: ManualApprovalConfig,
  returnTo: string | null,
): Promise<{ location: string; binding: string }> {
  const state = randomToken();
  const binding = randomToken();
  const codeVerifier = randomToken();
  await createOAuthTransaction(sql, {
    state,
    browserBindingHash: hashToken(binding),
    codeVerifier,
    returnTo: safeReturnTo(returnTo),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(config),
    state,
    code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    allow_signup: 'false',
  });
  return { location: `${AUTHORIZE_URL}?${query}`, binding };
}

export type LoginResult =
  | { kind: 'ok'; sessionToken: string; returnTo: string }
  | { kind: 'invalid' }
  | { kind: 'forbidden' };

const TokenResponse = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);
const UserSchema = z.object({ id: z.int().positive(), login: z.string().min(1) });

/**
 * callback 처리. state는 한 번만 소비되고, 쿠키 binding · PKCE verifier가 맞아야 code를 교환한다.
 * `GET /user`의 numeric ID만 신뢰하고, 사용자 토큰은 이 함수 안에서만 쓰고 버린다.
 * 운영자가 아니면 세션을 만들지 않는다.
 */
export async function completeLogin(
  deps: { sql: Db; transport: Transport; config: ManualApprovalConfig; deadline: Deadline },
  input: { code: string | null; state: string | null; binding: string | null },
): Promise<LoginResult> {
  const { sql, transport, config, deadline } = deps;
  if (!input.code || !input.state || !input.binding) return { kind: 'invalid' };
  const transaction = await consumeOAuthTransaction(sql, input.state);
  if (!transaction) return { kind: 'invalid' };
  const expected = Buffer.from(transaction.browserBindingHash);
  const received = Buffer.from(hashToken(input.binding));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { kind: 'invalid' };
  }

  const userToken = await exchangeCode(
    transport,
    config,
    input.code,
    transaction.codeVerifier,
    deadline,
  );
  if (!userToken) return { kind: 'invalid' };
  const { data: user } = await githubRequest(transport, {
    method: 'GET',
    url: '/user',
    token: userToken,
    deadline,
    schema: UserSchema,
  });
  if (!config.approverIds.has(user.id)) return { kind: 'forbidden' };

  const sessionToken = randomToken();
  await createSession(sql, {
    tokenHash: hashToken(sessionToken),
    githubUserId: user.id,
    login: user.login,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return { kind: 'ok', sessionToken, returnTo: transaction.returnTo };
}

/** code → 사용자 토큰. GitHub은 실패도 200 + `error`로 돌려줄 수 있다. 실패면 null. */
async function exchangeCode(
  transport: Transport,
  config: ManualApprovalConfig,
  code: string,
  codeVerifier: string,
  deadline: Deadline,
): Promise<string | null> {
  const timeout = remainingMs(deadline);
  if (timeout <= 0) return null;
  const response = await transport(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: callbackUrl(config),
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) return null;
  const parsed = TokenResponse.safeParse(await response.json());
  return parsed.success && 'access_token' in parsed.data ? parsed.data.access_token : null;
}
