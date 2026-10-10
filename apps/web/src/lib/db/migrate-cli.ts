/**
 * `pnpm db:migrate` — `DATABASE_URL`의 DB에 `apps/web/db/migrations`를 적용한다.
 * Node의 type stripping으로 직접 실행하므로 상대 import에 `.ts`를 붙인다.
 */
import { fileURLToPath } from 'node:url';

import { openDatabase, readDatabaseConfig } from './config.ts';
import { migrate } from './migrate.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

const sql = openDatabase(readDatabaseConfig(), { max: 1 });
try {
  const applied = await migrate(sql, MIGRATIONS_DIR);
  console.log(applied.length > 0 ? `Applied ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await sql.end();
}
