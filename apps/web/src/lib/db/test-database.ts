import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { type Db, openDatabase, readDatabaseConfig } from './config.ts';
import { migrate } from './migrate.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

export type TestDatabase = {
  /** 격리된 schema에 붙은 연결. migration이 적용돼 있다. */
  sql: Db;
  schema: string;
  /** 같은 schema에 새 연결 pool을 연다. 프로세스 재시작을 흉내 낼 때 쓴다. */
  connect: () => Db;
  close: () => Promise<void>;
};

/**
 * DB 통합 테스트용 schema를 하나 만든다. `TEST_DATABASE_URL`이 없으면 실패한다 — 조용히 건너뛰지 않는다.
 * 테스트 DB는 review-platform 전용이어야 한다. 다른 서비스의 DB를 가리키지 않는다.
 */
export async function openTestDatabase({ migrated = true } = {}): Promise<TestDatabase> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See docs/manual-approval/architecture.md#14-로컬-db',
    );
  }
  const config = readDatabaseConfig({ DATABASE_URL: url });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = openDatabase(config, { max: 1 });
  await admin`CREATE SCHEMA ${admin(schema)}`;
  const opened: Db[] = [];
  const connect = () => {
    const sql = openDatabase(config, { searchPath: schema });
    opened.push(sql);
    return sql;
  };
  const sql = connect();
  if (migrated) await migrate(sql, MIGRATIONS_DIR);
  return {
    sql,
    schema,
    connect,
    close: async () => {
      await Promise.all(opened.map((pool) => pool.end()));
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    },
  };
}

/** 테스트에서 있어야 하는 값. 없으면 non-null 단언 대신 이유를 담아 실패한다. */
export function present<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present`);
  return value;
}
