import type { Db } from '../db/config.ts';

/** delivery 식별에 필요한 최소 정보. payload 원문은 저장하지 않는다. */
export type DeliveryHeader = {
  deliveryId: string;
  event: string;
  action: string | null;
  repositoryId: number | null;
  installationId: number | null;
  pullNumber: number | null;
};

export type DeliveryStart =
  { kind: 'process'; attempt: number } | { kind: 'duplicate' } | { kind: 'in-progress' };

/**
 * delivery 처리를 시작한다. 처음 보거나, 이전 시도가 `failed`이거나, `processing`인 채 `staleAfterMs`가 지났으면
 * 처리 권한을 준다 — GitHub Redeliver는 같은 delivery ID로 온다. 끝까지 처리된(`done` · `ignored`) delivery만 no-op이다.
 */
export async function beginDelivery(
  sql: Db,
  header: DeliveryHeader,
  staleAfterMs: number,
): Promise<DeliveryStart> {
  const [started] = await sql<{ attempts: number }[]>`
    INSERT INTO webhook_deliveries (
      delivery_id, event, action, repository_id, installation_id, pull_number, status
    ) VALUES (
      ${header.deliveryId}, ${header.event}, ${header.action}, ${header.repositoryId},
      ${header.installationId}, ${header.pullNumber}, 'processing'
    )
    ON CONFLICT (delivery_id) DO UPDATE SET
      status = 'processing', attempts = webhook_deliveries.attempts + 1,
      started_at = now(), finished_at = NULL, last_error = NULL
    WHERE webhook_deliveries.status = 'failed'
       OR (webhook_deliveries.status = 'processing'
           AND webhook_deliveries.started_at < now() - make_interval(secs => ${staleAfterMs / 1000}))
    RETURNING attempts`;
  if (started) return { kind: 'process', attempt: started.attempts };
  const [existing] = await sql<{ status: string }[]>`
    SELECT status FROM webhook_deliveries WHERE delivery_id = ${header.deliveryId}`;
  return existing?.status === 'processing' ? { kind: 'in-progress' } : { kind: 'duplicate' };
}

export type DeliveryOutcome = { status: 'done' | 'ignored' } | { status: 'failed'; error: string };

/**
 * delivery 결과를 기록한다. `attempt`가 지금 시도와 같을 때만 쓴다 — 만료 뒤 늦게 끝난 이전 시도가
 * 새 시도의 상태를 덮지 않는다. 기록했으면 true.
 */
export async function finishDelivery(
  sql: Db,
  deliveryId: string,
  attempt: number,
  outcome: DeliveryOutcome,
): Promise<boolean> {
  const error = outcome.status === 'failed' ? outcome.error.slice(0, 500) : null;
  const updated = await sql`
    UPDATE webhook_deliveries SET status = ${outcome.status}, last_error = ${error}, finished_at = now()
    WHERE delivery_id = ${deliveryId} AND attempts = ${attempt} AND status = 'processing'`;
  return updated.count === 1;
}
