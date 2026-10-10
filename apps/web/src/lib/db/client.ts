import 'server-only';

import { type Db, openDatabase, readDatabaseConfig } from './config.ts';

let sql: Db | undefined;

/**
 * 승인 경로에서 처음 부를 때 연결 pool을 만든다. Visual 화면은 이 모듈을 import하지 않으므로 DB 없이 동작한다.
 * `DATABASE_URL`이 없으면 `ConfigurationError`를 던진다. fixture나 메모리 저장으로 대신하지 않는다.
 */
export function getSql(): Db {
  sql ??= openDatabase(readDatabaseConfig());
  return sql;
}
