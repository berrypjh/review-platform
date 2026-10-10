import type { Db, Tx } from './config.ts';

/**
 * 시간 제한을 건 transaction. 문장 5초, transaction 안에서 쉬는 시간 10초를 넘으면 서버가 끊는다.
 * `SET LOCAL`이라 transaction pooler에서도 다른 요청에 새지 않는다.
 * GitHub 호출을 이 안에서 하지 않는다.
 */
export function inTransaction<T>(sql: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    return work(tx);
  }) as Promise<T>;
}
