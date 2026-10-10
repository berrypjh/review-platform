import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from './migrate.ts';
import { MIGRATIONS_DIR, openTestDatabase, type TestDatabase } from './test-database.ts';

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase({ migrated: false });
});

afterEach(async () => {
  await db.close();
});

const ALL = ['0001_manual_approval.sql', '0002_cancel_obsolete_checks.sql'];

const tables = async () =>
  (
    await db.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = ${db.schema} ORDER BY table_name`
  ).map((row) => row.name);

describe('migrate', () => {
  it('applies every migration to an empty schema and is a no-op when run again', async () => {
    expect(await migrate(db.sql, MIGRATIONS_DIR)).toEqual(ALL);
    expect(await tables()).toEqual([
      'oauth_transactions',
      'pull_request_claims',
      'pull_requests',
      'revisions',
      'schema_migrations',
      'sessions',
      'webhook_deliveries',
    ]);
    expect(await migrate(db.sql, MIGRATIONS_DIR)).toEqual([]);
  });

  it('serializes concurrent runs so each migration applies once', async () => {
    const other = db.connect();
    const results = await Promise.all([
      migrate(db.sql, MIGRATIONS_DIR),
      migrate(other, MIGRATIONS_DIR),
    ]);
    expect(results.flat()).toEqual(ALL);
  });

  it('keeps existing data when a later migration is added', async () => {
    await migrate(db.sql, MIGRATIONS_DIR);
    await db.sql`
      INSERT INTO sessions (token_hash, github_user_id, login, expires_at)
      VALUES (${new Uint8Array(32)}, 1, 'operator', now() + interval '1 hour')`;
    const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
    try {
      await writeFile(join(dir, '0001_manual_approval.sql'), '-- already applied');
      await writeFile(join(dir, '0002_add_note.sql'), 'ALTER TABLE sessions ADD COLUMN note text;');
      expect(await migrate(db.sql, dir)).toEqual(['0002_add_note.sql']);
      const [row] = await db.sql`SELECT login, note FROM sessions`;
      expect(row).toEqual({ login: 'operator', note: null });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('rolls back every file when one of them fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
    try {
      await writeFile(join(dir, '0001_ok.sql'), 'CREATE TABLE first_table (id int);');
      await writeFile(join(dir, '0002_broken.sql'), 'CREATE TABLE broken (;');
      await expect(migrate(db.sql, dir)).rejects.toThrow();
      expect(await tables()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
