import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Db } from './config.ts';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** 동시에 migration을 돌리는 두 프로세스를 직렬화하는 transaction 범위 advisory lock 키. */
const MIGRATION_LOCK = 72_011_001;

/**
 * 번호 순서로 아직 적용하지 않은 migration만 적용하고, 적용한 파일 이름을 돌려준다.
 * 전체를 transaction 하나로 돌려 중간에 실패하면 아무것도 남기지 않는다. 기존 테이블을 지우지 않는다.
 * 파일은 저장소에 커밋된 SQL이므로 `unsafe`로 실행한다. 사용자 입력을 여기에 넣지 않는다.
 */
export async function migrate(sql: Db, directory: string): Promise<string[]> {
  const files = (await readdir(directory)).filter((file) => MIGRATION_FILE.test(file)).sort();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    const done = new Set(
      (await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
    );
    const applied: string[] = [];
    for (const file of files.filter((name) => !done.has(name))) {
      await tx.unsafe(await readFile(join(directory, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
    return applied;
  }) as Promise<string[]>;
}
