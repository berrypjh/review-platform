import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Db } from '../db/config.ts';
import type { ManualApprovalConfig } from '../manual-approval/config.ts';
import { findSession, type SessionUser } from './store.ts';

/** `__Host-`: Secure · Path=/ · Domain 없음을 브라우저가 강제한다. */
export const SESSION_COOKIE = '__Host-rp_session';
export const OAUTH_COOKIE = '__Host-rp_oauth';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** 32 bytes 무작위 값(base64url 43자). 세션 token · OAuth state · binding · PKCE verifier에 쓴다. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** DB에는 token 원문 대신 이 SHA-256만 둔다. */
export const hashToken = (token: string) =>
  new Uint8Array(createHash('sha256').update(token).digest());

/**
 * 세션에 묶인 CSRF token. 세션 token 원문이 있어야 계산되므로 따로 저장하지 않는다.
 * 화면은 이 값을 form에 넣고, mutation route는 다시 계산해 비교한다.
 */
export const csrfTokenFor = (sessionToken: string) =>
  createHash('sha256').update(`csrf:${sessionToken}`).digest('base64url');

const sameBytes = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const clearCookie = (name: string) => cookie(name, '', 0);

export function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/** 유효한 세션의 운영자. 세션이 만료 · 철회됐거나 `APPROVER_GITHUB_IDS`에 없으면 null — 매 요청 다시 판정한다. */
export async function currentOperator(
  sql: Db,
  config: ManualApprovalConfig,
  sessionToken: string | null,
): Promise<SessionUser | null> {
  if (!sessionToken) return null;
  const user = await findSession(sql, hashToken(sessionToken));
  return user && config.approverIds.has(user.githubUserId) ? user : null;
}

export type MutationRequest = {
  origin: string | null;
  cookieHeader: string | null;
  csrfToken: string | null;
};

export type MutationGuard =
  | { kind: 'ok'; operator: SessionUser; sessionToken: string }
  | { kind: 'bad-origin' | 'unauthenticated' | 'bad-csrf' };

/**
 * POST mutation(승인 · 재동기화 · 로그아웃) 공통 검사. Origin이 `PUBLIC_BASE_URL`과 정확히 같고,
 * 운영자 세션이 유효하고, 세션에 묶인 CSRF token이 맞아야 한다. 요청 body의 사용자 정보는 쓰지 않는다.
 */
export async function guardMutation(
  sql: Db,
  config: ManualApprovalConfig,
  request: MutationRequest,
): Promise<MutationGuard> {
  if (request.origin !== config.publicBaseUrl) return { kind: 'bad-origin' };
  const sessionToken = readCookie(request.cookieHeader, SESSION_COOKIE);
  const operator = await currentOperator(sql, config, sessionToken);
  if (!operator || !sessionToken) return { kind: 'unauthenticated' };
  if (!request.csrfToken || !sameBytes(request.csrfToken, csrfTokenFor(sessionToken))) {
    return { kind: 'bad-csrf' };
  }
  return { kind: 'ok', operator, sessionToken };
}
