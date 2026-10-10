import type { Db } from '../db/config.ts';

/** 유효한 세션의 주인. 운영자 여부는 매 요청 `APPROVER_GITHUB_IDS`로 다시 판정한다(Step 4). */
export type SessionUser = { githubUserId: number; login: string };

/** 세션을 만든다. token 원문이 아니라 SHA-256 hash(32 bytes)만 받는다. */
export async function createSession(
  sql: Db,
  session: SessionUser & { tokenHash: Uint8Array; expiresAt: Date },
): Promise<void> {
  await sql`
    INSERT INTO sessions (token_hash, github_user_id, login, expires_at)
    VALUES (${session.tokenHash}, ${session.githubUserId}, ${session.login}, ${session.expiresAt})`;
}

/** 만료 · 철회되지 않은 세션의 주인. 없으면 null이다. */
export async function findSession(sql: Db, tokenHash: Uint8Array): Promise<SessionUser | null> {
  const [row] = await sql<SessionUser[]>`
    SELECT github_user_id AS "githubUserId", login FROM sessions
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND expires_at > now()`;
  return row ?? null;
}

export async function revokeSession(sql: Db, tokenHash: Uint8Array): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
}

/** 한 사용자의 세션을 모두 철회한다. App authorization 철회 webhook이 쓴다. 철회한 개수를 돌려준다. */
export async function revokeUserSessions(sql: Db, githubUserId: number): Promise<number> {
  const updated = await sql`
    UPDATE sessions SET revoked_at = now() WHERE github_user_id = ${githubUserId} AND revoked_at IS NULL`;
  return updated.count;
}

export type OAuthTransaction = {
  state: string;
  browserBindingHash: Uint8Array;
  codeVerifier: string;
  returnTo: string;
  expiresAt: Date;
};

export async function createOAuthTransaction(
  sql: Db,
  transaction: OAuthTransaction,
): Promise<void> {
  await sql`
    INSERT INTO oauth_transactions (state, browser_binding_hash, code_verifier, return_to, expires_at)
    VALUES (${transaction.state}, ${transaction.browserBindingHash}, ${transaction.codeVerifier},
            ${transaction.returnTo}, ${transaction.expiresAt})`;
}

/**
 * OAuth state를 한 번만 소비한다. 만료됐어도 지우고 null을 돌려준다.
 * 브라우저 binding 비교는 호출자(Step 4)가 `timingSafeEqual`로 한다.
 */
export async function consumeOAuthTransaction(
  sql: Db,
  state: string,
): Promise<Omit<OAuthTransaction, 'expiresAt'> | null> {
  const [row] = await sql<(Omit<OAuthTransaction, 'expiresAt'> & { expired: boolean })[]>`
    DELETE FROM oauth_transactions WHERE state = ${state}
    RETURNING state, browser_binding_hash AS "browserBindingHash", code_verifier AS "codeVerifier",
              return_to AS "returnTo", expires_at <= now() AS expired`;
  if (!row || row.expired) return null;
  return {
    state: row.state,
    browserBindingHash: row.browserBindingHash,
    codeVerifier: row.codeVerifier,
    returnTo: row.returnTo,
  };
}
