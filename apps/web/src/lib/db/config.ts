import postgres, { type Options, type PostgresType, type Sql, type TransactionSql } from 'postgres';

/** 승인 경로에 필요한 설정이 없거나 잘못됐다. 메시지에 설정 값을 넣지 않는다. */
export class ConfigurationError extends Error {
  override name = 'ConfigurationError';
}

export type DatabaseConfig = { url: string; ssl: false | 'verify-full' };

/** int8을 number로 읽는 연결. 승인 저장 계층의 모든 SQL이 이것을 받는다. */
export type Db = Sql<{ int8: number }>;
export type Tx = TransactionSql<{ int8: number }>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `DATABASE_URL`을 읽는다. URL query는 버린다 — `sslmode=require`는 인증서를 검증하지 않고,
 * `channel_binding` 같은 값은 서버 startup parameter로 넘어가 pooler가 거부할 수 있다.
 * TLS는 로컬이 아니면 항상 `verify-full`이다.
 */
export function readDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const raw = env['DATABASE_URL'];
  if (!raw) {
    throw new ConfigurationError(
      'DATABASE_URL is not set. Manual approval needs a PostgreSQL database.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError('DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ConfigurationError('DATABASE_URL must use the postgres:// scheme.');
  }
  url.search = '';
  return { url: url.toString(), ssl: LOCAL_HOSTS.has(url.hostname) ? false : 'verify-full' };
}

/** int8을 number로 읽는다. GitHub ID · 내부 ID는 2^53 안이고, 넘으면 조용히 잃지 않고 던진다. */
const safeInt8: PostgresType<number> = {
  to: 20,
  from: [20],
  serialize: (value: number) => String(value),
  parse: (value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw new RangeError('int8 value is outside the safe integer range');
    return number;
  },
};

/**
 * 서버리스 인스턴스용 연결 설정. 인스턴스마다 연결을 적게 두고, transaction pooler(Neon · PgBouncer)와
 * 맞도록 prepared statement를 쓰지 않는다. 문장 · transaction 시간 제한은 `inTransaction`이 건다.
 */
export function connectionOptions(config: DatabaseConfig) {
  return {
    ssl: config.ssl,
    max: 3,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
    prepare: false,
    connection: { application_name: 'review-platform' },
    types: { int8: safeInt8 },
    onnotice: () => undefined,
  } satisfies Options<Record<string, PostgresType>>;
}

/**
 * 연결 pool을 연다. `max`는 migration CLI가 1로, `searchPath`는 통합 테스트가 schema를 격리할 때만 준다.
 */
export function openDatabase(
  config: DatabaseConfig,
  { max, searchPath }: { max?: number; searchPath?: string } = {},
): Db {
  const options = connectionOptions(config);
  return postgres(config.url, {
    ...options,
    max: max ?? options.max,
    connection: searchPath
      ? { ...options.connection, search_path: searchPath }
      : options.connection,
  });
}
