import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase, present, type TestDatabase } from '../db/test-database.ts';
import {
  consumeOAuthTransaction,
  createOAuthTransaction,
  createSession,
  findSession,
  revokeSession,
  revokeUserSessions,
} from './store.ts';

const hash = (value: string) => new Uint8Array(createHash('sha256').update(value).digest());
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

afterEach(async () => {
  await db.close();
});

describe('sessions', () => {
  it('finds an active session by token hash and stops after revocation', async () => {
    const tokenHash = hash('token-1');
    await createSession(db.sql, {
      tokenHash,
      githubUserId: 42,
      login: 'operator',
      expiresAt: inMinutes(60),
    });
    expect(await findSession(db.sql, tokenHash)).toEqual({ githubUserId: 42, login: 'operator' });
    await revokeSession(db.sql, tokenHash);
    expect(await findSession(db.sql, tokenHash)).toBeNull();
  });

  it('ignores an expired session', async () => {
    const tokenHash = hash('token-2');
    await createSession(db.sql, {
      tokenHash,
      githubUserId: 42,
      login: 'operator',
      expiresAt: inMinutes(-1),
    });
    expect(await findSession(db.sql, tokenHash)).toBeNull();
  });

  it('revokes every session of a user whose authorization was withdrawn', async () => {
    for (const token of ['a', 'b']) {
      await createSession(db.sql, {
        tokenHash: hash(token),
        githubUserId: 42,
        login: 'operator',
        expiresAt: inMinutes(60),
      });
    }
    await createSession(db.sql, {
      tokenHash: hash('c'),
      githubUserId: 43,
      login: 'other',
      expiresAt: inMinutes(60),
    });
    expect(await revokeUserSessions(db.sql, 42)).toBe(2);
    expect(await findSession(db.sql, hash('c'))).not.toBeNull();
  });

  it('stores only the 32-byte hash', async () => {
    await expect(
      createSession(db.sql, {
        tokenHash: new TextEncoder().encode('raw-token'),
        githubUserId: 42,
        login: 'operator',
        expiresAt: inMinutes(60),
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('OAuth transactions', () => {
  const transaction = (state: string, expiresAt: Date) => ({
    state,
    browserBindingHash: hash(`binding-${state}`),
    codeVerifier: randomBytes(32).toString('base64url'),
    returnTo: '/pulls',
    expiresAt,
  });

  it('consumes a state exactly once', async () => {
    const tx = transaction(randomBytes(32).toString('base64url'), inMinutes(10));
    await createOAuthTransaction(db.sql, tx);
    const consumed = await Promise.all([
      consumeOAuthTransaction(db.sql, tx.state),
      consumeOAuthTransaction(db.connect(), tx.state),
    ]);
    const [winner, ...rest] = consumed.filter((row) => row !== null);
    expect(rest).toEqual([]);
    expect(winner).toMatchObject({
      state: tx.state,
      codeVerifier: tx.codeVerifier,
      returnTo: '/pulls',
    });
    // bytea는 Buffer로 돌아온다. 내용만 비교한다.
    expect(Buffer.from(present(winner).browserBindingHash).equals(tx.browserBindingHash)).toBe(
      true,
    );
  });

  it('deletes an expired state without returning it', async () => {
    const tx = transaction(randomBytes(32).toString('base64url'), inMinutes(-1));
    await createOAuthTransaction(db.sql, tx);
    expect(await consumeOAuthTransaction(db.sql, tx.state)).toBeNull();
    expect(await db.sql`SELECT 1 FROM oauth_transactions`).toHaveLength(0);
  });
});
